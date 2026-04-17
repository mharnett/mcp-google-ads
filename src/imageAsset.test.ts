import { describe, it, expect } from "vitest";
import {
  validateImageInput,
  detectMimeType,
  getImageDimensions,
  prepareImageForUpload,
} from "./imageAsset.js";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("validateImageInput", () => {
  it("rejects when neither file_path nor base64_data is provided", () => {
    const result = validateImageInput({ name: "x" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /file_path.*base64_data|either/i.test(e))).toBe(true);
  });

  it("rejects when both file_path and base64_data are provided", () => {
    const result = validateImageInput({ name: "x", file_path: "/tmp/foo.png", base64_data: "xxx" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exactly one|both/i.test(e))).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateImageInput({ name: "  ", file_path: "/tmp/foo.png" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /name/i.test(e))).toBe(true);
  });

  it("accepts valid input with just file_path", () => {
    const result = validateImageInput({ name: "logo", file_path: "/tmp/foo.png" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("detectMimeType", () => {
  it("detects PNG magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectMimeType(png)).toBe("image/png");
  });

  it("detects JPEG magic bytes", () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectMimeType(jpg)).toBe("image/jpeg");
  });

  it("detects GIF magic bytes", () => {
    const gif = Buffer.from("GIF89a\0\0", "ascii");
    expect(detectMimeType(gif)).toBe("image/gif");
  });

  it("returns null for unknown formats (webp, svg, text)", () => {
    expect(detectMimeType(Buffer.from("RIFF----WEBP"))).toBeNull();
    expect(detectMimeType(Buffer.from("<svg></svg>"))).toBeNull();
    expect(detectMimeType(Buffer.from("plain text here"))).toBeNull();
  });
});

describe("prepareImageForUpload", () => {
  function makeValidPng(width: number, height: number): Buffer {
    const buf = Buffer.alloc(24);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  }

  it("rejects when referenced file does not exist", () => {
    const result = prepareImageForUpload({
      name: "nope",
      file_path: "/definitely/not/a/real/path/for/testing-only.png",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /not found|does not exist/i.test(e))).toBe(true);
  });

  it("rejects image > 5MB", () => {
    const big = Buffer.concat([makeValidPng(1200, 628), Buffer.alloc(5_500_000)]);
    const result = prepareImageForUpload({ name: "big", base64_data: big.toString("base64") });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /too large|5MB/i.test(e))).toBe(true);
  });

  it("rejects wrong mime type (not PNG/JPG/GIF)", () => {
    const result = prepareImageForUpload({
      name: "bogus",
      base64_data: Buffer.from("<svg></svg>").toString("base64"),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Unrecognized.*format|PNG.*JPEG.*GIF/i.test(e))).toBe(true);
  });

  it("rejects image below Demand Gen min dimensions (600x314)", () => {
    const small = makeValidPng(500, 300);
    const result = prepareImageForUpload({ name: "small", base64_data: small.toString("base64") });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /below the Demand Gen minimum|600x314/.test(e))).toBe(true);
  });

  it("happy path: valid PNG via base64 returns bytes + mime + dimensions", () => {
    const png = makeValidPng(1200, 628);
    const result = prepareImageForUpload({ name: "ok", base64_data: png.toString("base64") });
    expect(result.valid).toBe(true);
    expect(result.mime_type).toBe("image/png");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(628);
    expect(result.bytes?.length).toBeGreaterThan(0);
  });

  it("happy path: valid PNG from file_path returns bytes + mime + dimensions", () => {
    const png = makeValidPng(1200, 628);
    const dir = mkdtempSync(join(tmpdir(), "mcp-img-"));
    const filePath = join(dir, "ok.png");
    writeFileSync(filePath, png);
    const result = prepareImageForUpload({ name: "ok", file_path: filePath });
    expect(result.valid).toBe(true);
    expect(result.mime_type).toBe("image/png");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(628);
  });
});

describe("getImageDimensions", () => {
  it("parses width/height from a PNG header", () => {
    // PNG header: signature(8) + IHDR chunk length(4) + "IHDR"(4) + width(4 BE) + height(4 BE) + ...
    const buf = Buffer.alloc(24);
    // Signature
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR chunk length (13) — not used by our parser
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(1200, 16); // width
    buf.writeUInt32BE(628, 20);  // height
    expect(getImageDimensions(buf, "image/png")).toEqual({ width: 1200, height: 628 });
  });
});
