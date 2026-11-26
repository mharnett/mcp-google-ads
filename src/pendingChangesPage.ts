/**
 * Fits google_ads_list_pending_changes into one response without losing the
 * totals or the way to the rest.
 *
 * Each section is one query's rows: one per item per claude- label. A response
 * always counts every matching row. When the rows do not all fit, the sections
 * take turns filling it, so a short section comes back whole, and each cut
 * section says the offset to continue from.
 */

export const PENDING_SECTIONS = ["campaigns", "adGroups", "ads", "keywords"] as const;
export type PendingSection = (typeof PENDING_SECTIONS)[number];

/** Per-label totals listed when a result is cut. */
export const MAX_LABELS_LISTED = 300;

export interface PendingChangesArgs {
  entityType?: PendingSection;
  offset: number;
  label?: string;
}

export interface SectionCounts {
  /** Rows matching: one per item per claude- label. */
  total_rows: number;
  /** Distinct campaigns, ad groups, ads (per ad group) or keywords. */
  total_items: number;
  returned_rows: number;
  /** Present when rows remain: the offset of the next page. */
  next_offset?: number;
}

/** Read the tool arguments. Throws before any query on one it cannot honor. */
export function parsePendingChangesArgs(args: Record<string, unknown> | undefined): PendingChangesArgs {
  const entityType = (args?.entity_type || undefined) as PendingSection | undefined;
  if (entityType !== undefined && !PENDING_SECTIONS.includes(entityType)) {
    throw new Error(`entity_type must be one of ${PENDING_SECTIONS.join(", ")}`);
  }
  const offset = args?.offset === undefined ? 0 : Number(args.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a whole number, 0 or more");
  }
  if (offset > 0 && !entityType) {
    throw new Error("offset needs entity_type: each section is paged on its own");
  }
  return { entityType, offset, label: (args?.label as string) || undefined };
}

const ITEM_ID: Record<PendingSection, (row: any) => string> = {
  campaigns: (r) => String(r.campaign?.id),
  adGroups: (r) => String(r.ad_group?.id),
  // One ad can sit in several ad groups, and each link is paused on its own.
  ads: (r) => `${r.ad_group?.id}~${r.ad_group_ad?.ad?.id}`,
  keywords: (r) => String(r.ad_group_criterion?.resource_name),
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The API promises no order without ORDER BY, and an offset only means
 * something if every call sees the same one.
 */
function inStableOrder(section: PendingSection, rows: any[]): any[] {
  return rows
    .map((row) => ({ row, id: ITEM_ID[section](row), label: String(row.label?.name) }))
    .sort((a, b) => compare(a.id, b.id) || compare(a.label, b.label))
    .map((entry) => entry.row);
}

/** Rows per label in each section, the labels with the most rows first. */
function labelTotals(sections: [PendingSection, any[]][]) {
  const totals = new Map<string, Record<string, number>>();
  for (const [section, rows] of sections) {
    for (const row of rows) {
      const name = String(row.label?.name);
      const counts = totals.get(name) ?? Object.fromEntries(sections.map(([s]) => [s, 0]));
      counts[section] += 1;
      totals.set(name, counts);
    }
  }
  const size = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
  return [...totals]
    .sort(([nameA, a], [nameB, b]) => size(b) - size(a) || compare(nameA, nameB))
    .map(([label, counts]) => ({ label, ...counts }));
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf-8");

/**
 * Build the response from the queried sections: all four, or the one named by
 * entity_type. Its compact JSON stays within maxBytes.
 */
export function pagePendingChanges(
  queried: Partial<Record<PendingSection, any[]>>,
  args: PendingChangesArgs,
  maxBytes: number,
): Record<string, unknown> {
  const sections = PENDING_SECTIONS.filter((s) => queried[s]).map((s): [PendingSection, any[]] => {
    const matching = args.label ? queried[s]!.filter((r) => r.label?.name === args.label) : queried[s]!;
    return [s, inStableOrder(s, matching)];
  });

  const counts: Partial<Record<PendingSection, SectionCounts>> = {};
  const response: Record<string, unknown> = { ...(args.label && { label: args.label }), counts };
  const pages = sections.map(([section, rows]) => {
    const waiting = rows.slice(args.offset);
    const page: any[] = [];
    response[section] = page;
    counts[section] = {
      total_rows: rows.length,
      total_items: new Set(rows.map(ITEM_ID[section])).size,
      returned_rows: waiting.length,
    };
    return { section, waiting, page };
  });

  // Everything left fits: no marks needed.
  const whole = { ...response, ...Object.fromEntries(pages.map((p) => [p.section, p.waiting])) };
  if (bytes(whole) <= maxBytes) return whole;

  const labels = labelTotals(sections);
  response.truncated = true;
  response.how_to_get_the_rest =
    "Not every row is here. For each section with a next_offset, call again with that entity_type " +
    "and offset=next_offset until next_offset is gone. Add label to narrow to one label. " +
    "If a total changes between pages, items changed: start again at offset 0.";
  response.labels = labels.slice(0, MAX_LABELS_LISTED);
  if (labels.length > MAX_LABELS_LISTED) response.total_labels = labels.length;

  // Reserve room for the largest next_offset each section could report.
  for (const { section, waiting } of pages) counts[section]!.next_offset = args.offset + waiting.length;
  let room = maxBytes - bytes(response);

  const open = new Set(pages.filter((p) => p.waiting.length > 0));
  while (open.size > 0) {
    for (const entry of open) {
      const row = entry.waiting[entry.page.length];
      const cost = row === undefined ? 0 : bytes(row) + 1; // +1 for the comma
      // A section always gets its first row, so a page always moves on.
      if (row === undefined || (cost > room && entry.page.length > 0)) {
        open.delete(entry);
        continue;
      }
      entry.page.push(row);
      room -= cost;
    }
  }

  let remaining = false;
  for (const { section, waiting, page } of pages) {
    const count = counts[section]!;
    count.returned_rows = page.length;
    if (page.length < waiting.length) {
      count.next_offset = args.offset + page.length;
      remaining = true;
    } else {
      delete count.next_offset;
    }
  }
  if (!remaining) {
    delete response.truncated;
    delete response.how_to_get_the_rest;
  }
  return response;
}
