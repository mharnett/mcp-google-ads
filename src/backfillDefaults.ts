import { parse as circJsonParse } from "circ-json";
// Deep internal path, no public export for this registry; mirrors
// google-ads-api's own parserRest.js, which requires the exact same file.
import fieldsMod from "google-ads-api/build/src/protos/autogen/fields.js";

type FieldTypeNode = string | { [key: string]: FieldTypeNode };

let cachedFieldDataTypes: Record<string, FieldTypeNode> | null = null;

function getFieldDataTypes(): Record<string, FieldTypeNode> {
  if (!cachedFieldDataTypes) {
    cachedFieldDataTypes = circJsonParse(fieldsMod.fieldDataTypes) as Record<string, FieldTypeNode>;
  }
  return cachedFieldDataTypes;
}

function snakeToPascal(snake: string): string {
  return snake
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Extract the selected field paths from a GAQL query's SELECT clause. */
export function extractSelectedFields(query: string): string[] {
  const match = query.match(/SELECT\s+(.*?)\s+FROM\s/is);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Resolve a dotted GAQL field path (e.g. "ad_group.optimized_targeting_enabled")
 * to its primitive type tag (e.g. "BOOL"). Returns undefined if the path can't
 * be resolved, or if it resolves to a nested message/enum object rather than a
 * scalar leaf -- callers only act on an exact string type match.
 */
export function resolveFieldType(fieldPath: string): string | undefined {
  const segments = fieldPath.split(".");
  if (segments.length < 2) return undefined;
  const types = getFieldDataTypes();
  let current: FieldTypeNode | undefined = types[snakeToPascal(segments[0])];
  for (let i = 1; i < segments.length && current !== undefined; i++) {
    if (typeof current !== "object") return undefined;
    current = current[segments[i]];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Google Ads' REST API omits fields at their proto3 default value (e.g.
 * `false`) entirely from the JSON body -- our tool then serializes the row
 * with no key at all, indistinguishable from "not returned"/error. This
 * backfills an explicit `false` for any selected BOOL leaf field missing from
 * a row whose parent object IS present, so callers can trust that an absent
 * boolean key never means "unknown" -- only a truly absent parent resource
 * (e.g. a metrics-only row) is left untouched, never fabricated.
 */
export function backfillOmittedBooleans<T = any>(query: string, rows: T[]): T[] {
  const boolPaths = extractSelectedFields(query).filter((f) => resolveFieldType(f) === "BOOL");
  if (boolPaths.length === 0) return rows;

  for (const row of rows) {
    for (const path of boolPaths) {
      const segments = path.split(".");
      const leaf = segments[segments.length - 1];
      let parent: any = row;
      let reachable = true;
      for (let i = 0; i < segments.length - 1; i++) {
        if (parent == null || typeof parent !== "object") {
          reachable = false;
          break;
        }
        parent = parent[segments[i]];
      }
      if (reachable && parent != null && typeof parent === "object" && !(leaf in parent)) {
        parent[leaf] = false;
      }
    }
  }
  return rows;
}
