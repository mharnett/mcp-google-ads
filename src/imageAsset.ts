/**
 * Pure helpers for google_ads_create_image_asset. Separated from the manager
 * so validation logic (mime type, size caps, min dimensions) can be unit tested
 * without touching disk or the Google Ads API.
 */

import { readFileSync, existsSync, statSync } from "fs";

export interface ImageInput {
  name: string;
  file_path?: string;
  base64_data?: string;
}

export interface ImageValidationResult {
  valid: boolean;
  errors: string[];
}

export const MAX_IMAGE_BYTES = 5_242_880; // 5 MiB
export const MIN_IMAGE_WIDTH = 600;        // Demand Gen minimum
export const MIN_IMAGE_HEIGHT = 314;       // Demand Gen minimum
export const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif"] as const;

/**
 * Detect image mime type from magic bytes. Returns null for anything that
 * isn't PNG/JPEG/GIF. Google Ads asset uploads only accept these three formats
 * for image assets.
 */
export function detectMimeType(bytes: Buffer | Uint8Array): "image/png" | "image/jpeg" | "image/gif" | null {
  if (!bytes || bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

/**
 * Return {width, height} parsed from image headers for PNG / JPEG / GIF.
 * Returns null if the header couldn't be parsed (too short, unexpected format).
 * We only support these 3 formats — Google Ads image assets accept the same set.
 */
export function getImageDimensions(
  bytes: Buffer,
  mime: "image/png" | "image/jpeg" | "image/gif"
): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      // Width at offset 16 (BE uint32), height at 20.
      if (bytes.length < 24) return null;
      return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
    }
    if (mime === "image/gif") {
      // GIF89a: width at offset 6 (LE uint16), height at 8.
      if (bytes.length < 10) return null;
      return {
        width: bytes.readUInt16LE(6),
        height: bytes.readUInt16LE(8),
      };
    }
    if (mime === "image/jpeg") {
      // Walk JPEG markers until we hit an SOFn (Start-of-Frame) marker.
      let i = 2; // skip FFD8
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        // SOF markers 0xC0..0xCF (exclude 0xC4=DHT, 0xC8=reserved, 0xCC=DAC)
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          const height = bytes.readUInt16BE(i + 5);
          const width = bytes.readUInt16BE(i + 7);
          return { width, height };
        }
        // Segment length follows marker (BE uint16) and includes itself
        const segmentLen = bytes.readUInt16BE(i + 2);
        i += 2 + segmentLen;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateImageInput(input: ImageInput): ImageValidationResult {
  const errors: string[] = [];

  if (!input.name || !input.name.trim()) {
    errors.push("name is required");
  }

  const hasPath = typeof input.file_path === "string" && input.file_path.trim().length > 0;
  const hasData = typeof input.base64_data === "string" && input.base64_data.trim().length > 0;

  if (!hasPath && !hasData) {
    errors.push("Either file_path or base64_data must be provided");
  }
  if (hasPath && hasData) {
    errors.push("Provide exactly one of file_path or base64_data, not both");
  }

  return { valid: errors.length === 0, errors };
}

export interface PreparedImage {
  valid: boolean;
  errors: string[];
  /** Populated only when valid=true. */
  bytes?: Buffer;
  mime_type?: "image/png" | "image/jpeg" | "image/gif";
  width?: number;
  height?: number;
}

/**
 * End-to-end validation + decode: given the tool inputs, read the bytes
 * (from disk or base64), sniff the mime type, check size + dimensions, and
 * return a PreparedImage ready to be handed to customer.assets.create.
 *
 * Does NOT hit the Google Ads API. All errors are returned in errors[].
 */
export function prepareImageForUpload(input: ImageInput): PreparedImage {
  const inputValidation = validateImageInput(input);
  if (!inputValidation.valid) {
    return { valid: false, errors: inputValidation.errors };
  }

  let bytes: Buffer;
  try {
    if (input.file_path) {
      if (!existsSync(input.file_path)) {
        return {
          valid: false,
          errors: [`File not found: ${input.file_path}`],
        };
      }
      const stat = statSync(input.file_path);
      if (!stat.isFile()) {
        return {
          valid: false,
          errors: [`Path is not a regular file: ${input.file_path}`],
        };
      }
      bytes = readFileSync(input.file_path);
    } else {
      bytes = Buffer.from(input.base64_data!, "base64");
      if (bytes.length === 0) {
        return { valid: false, errors: ["base64_data decoded to zero bytes"] };
      }
    }
  } catch (err: any) {
    return { valid: false, errors: [`Failed to read image: ${err.message}`] };
  }

  const errors: string[] = [];

  if (bytes.length > MAX_IMAGE_BYTES) {
    errors.push(
      `Image too large: ${bytes.length} bytes (max ${MAX_IMAGE_BYTES} = 5MB)`
    );
  }

  const mime = detectMimeType(bytes);
  if (!mime) {
    errors.push(
      `Unrecognized image format. Only PNG, JPEG, and GIF are accepted for Google Ads image assets.`
    );
    return { valid: false, errors };
  }

  const dims = getImageDimensions(bytes, mime);
  if (!dims) {
    errors.push(`Could not parse image dimensions from header (corrupt file?)`);
    return { valid: false, errors };
  }

  if (dims.width < MIN_IMAGE_WIDTH || dims.height < MIN_IMAGE_HEIGHT) {
    errors.push(
      `Image dimensions ${dims.width}x${dims.height} are below the Demand Gen minimum ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT}`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      bytes,
      mime_type: mime,
      width: dims.width,
      height: dims.height,
    };
  }

  return {
    valid: true,
    errors: [],
    bytes,
    mime_type: mime,
    width: dims.width,
    height: dims.height,
  };
}
