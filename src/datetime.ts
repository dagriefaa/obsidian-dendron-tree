import { moment } from "obsidian";
import type MomentDefault from "moment";

/** Datetime format used for created/updated frontmatter values (hardcoded) */
export const FRONTMATTER_DATETIME_FORMAT = "YYYY-MM-DDTHH:mm:ss";

// Obsidian's typings type moment as a namespace import that TS refuses to call;
// cast to the callable moment static (same runtime object).
const momentFn = moment as unknown as typeof MomentDefault;

/**
 * Legacy timestamps below this value (in the same unit) are treated as
 * unix seconds, above as unix milliseconds.
 */
const MILLISECOND_THRESHOLD = 1e12;

/**
 * Check whether a frontmatter value is a legacy unix timestamp
 * (unix seconds/millis as number or numeric string).
 */
export function isLegacyTimestamp(value: unknown): value is number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return /^\d+$/.test(value.trim());
  return false;
}

export function timestampToMillis(value: number): number {
  return value < MILLISECOND_THRESHOLD ? value * 1000 : value;
}

/**
 * Convert a legacy unix timestamp to a datetime string in the given moment format.
 */
export function toDatetimeString(value: number, format: string): string {
  return momentFn(timestampToMillis(value)).format(format);
}

/**
 * Convert a legacy unix timestamp value (number or numeric string) to a
 * datetime string, or return undefined when it is not a legacy timestamp.
 */
export function legacyToDatetime(value: unknown, format: string): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return toDatetimeString(value, format);
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return toDatetimeString(parseInt(value.trim(), 10), format);
  return undefined;
}

/**
 * Convert a created/updated frontmatter value to a timestamp in milliseconds
 * for sorting; supports legacy unix timestamps (seconds/millis), datetime
 * strings and Date objects; returns Infinity for missing/invalid values.
 */
export function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return isLegacyTimestamp(value) ? timestampToMillis(value) : Infinity;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return timestampToMillis(parseInt(trimmed, 10));
    if (trimmed.length > 0) {
      const parsed = momentFn(trimmed);
      if (parsed.isValid()) return parsed.valueOf();
    }
  }
  return Infinity;
}