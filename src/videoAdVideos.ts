/**
 * Video responsive ad video management — pure helpers.
 *
 * Platform reality (verified live 2026-07-18): the Google Ads API rejects
 * every campaign-level mutate on the VIDEO channel (MUTATE_NOT_ALLOWED),
 * but AD-level updates of `video_responsive_ad.videos` succeed and edit the
 * ad in place (same ad ID). Source videos must be Public or Unlisted on
 * YouTube — private videos are rejected / stop serving, and their oEmbed
 * endpoint returns 401/403, which is the cheap preflight fingerprint.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract an 11-char YouTube video ID from a bare ID or any common URL form
 * (youtu.be/, watch?v=, /shorts/, /embed/). Returns null if unparseable.
 */
export function parseYoutubeVideoId(input: string): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") {
      candidate = url.searchParams.get("v");
    } else if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") {
      candidate = segments[1] ?? null;
    }
  }
  return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
}

/**
 * Parse + validate a list of user-supplied video URLs/IDs.
 * Errors on unparseable entries, duplicates (after normalization), and
 * empty input. `ids` preserves input order.
 */
export function validateYoutubeVideoInputs(inputs: string[]): {
  valid: boolean;
  ids: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const ids: string[] = [];
  if (!inputs || inputs.length === 0) {
    return { valid: false, ids, errors: ["No videos provided"] };
  }
  const seen = new Set<string>();
  for (const input of inputs) {
    const id = parseYoutubeVideoId(input);
    if (!id) {
      errors.push(`Not a YouTube video URL or 11-char video ID: "${input}"`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`Duplicate video: "${input}" resolves to ${id}, already in the list`);
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return { valid: errors.length === 0, ids, errors };
}

/**
 * Compute the target video-asset list for the update.
 * append: current list first (order preserved), then genuinely new assets.
 * replace: exactly the requested list (deduped, order preserved).
 */
export function planVideoUpdate(
  currentAssetRNs: string[],
  requestedAssetRNs: string[],
  mode: "append" | "replace"
): {
  videos: string[];
  added: string[];
  skipped_existing: string[];
  unchanged: boolean;
} {
  const current = [...currentAssetRNs];
  const requested = [...new Set(requestedAssetRNs)];
  const currentSet = new Set(current);

  let videos: string[];
  if (mode === "replace") {
    videos = requested;
  } else {
    videos = [...current, ...requested.filter((rn) => !currentSet.has(rn))];
  }

  const added = videos.filter((rn) => !currentSet.has(rn));
  const skipped_existing = mode === "append" ? requested.filter((rn) => currentSet.has(rn)) : [];
  const unchanged = videos.length === current.length && videos.every((rn, i) => rn === current[i]);

  return { videos, added, skipped_existing, unchanged };
}

/**
 * Build the mutate resource for the ad-level update. NOTE: the target is the
 * `ads` resource (customers/X/ads/Y), NOT `adGroupAds` — this is what makes
 * the mutate legal on the VIDEO channel.
 */
export function buildVideoAdUpdateResource(
  customerId: string,
  adId: string,
  assetResourceNames: string[]
): {
  resource_name: string;
  video_responsive_ad: { videos: Array<{ asset: string }> };
} {
  const cleanId = customerId.replace(/-/g, "");
  return {
    resource_name: `customers/${cleanId}/ads/${adId}`,
    video_responsive_ad: {
      videos: assetResourceNames.map((asset) => ({ asset })),
    },
  };
}

export interface VisibilityResult {
  visible: boolean | null; // null = indeterminate (network failure)
  title?: string;
  reason?: string;
}

/**
 * Best-effort preflight: YouTube's oEmbed endpoint returns 200 (+ title) for
 * Public/Unlisted videos and 401/403 for private or unavailable ones. On
 * network failure the check is indeterminate — never blocks the mutate.
 */
export async function checkYoutubeVisibility(
  videoId: string,
  fetchFn: typeof fetch = fetch
): Promise<VisibilityResult> {
  try {
    const resp = await fetchFn(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (resp.ok) {
      let title: string | undefined;
      try {
        title = ((await resp.json()) as any)?.title;
      } catch {
        // 200 without parseable JSON still means visible
      }
      return { visible: true, title };
    }
    return {
      visible: false,
      reason: `YouTube oEmbed returned ${resp.status} — video ${videoId} looks private or unavailable. Ads require Public or Unlisted videos.`,
    };
  } catch (e: any) {
    return { visible: null, reason: `visibility check failed: ${e?.message ?? e}` };
  }
}
