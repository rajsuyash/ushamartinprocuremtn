// Pure helpers for the `?series=<materialCode>:<plantCode>` query param (F3-AC2).
// No db/React import — unit-testable without mocking.

export interface SeriesKey {
  materialCode: string;
  plantCode: string;
}

/** Encodes a series as the `?series=` query value, e.g. `WR-5.5-HC:RNC`. */
export function formatSeriesKey(key: SeriesKey): string {
  return `${key.materialCode}:${key.plantCode}`;
}

/** Parses the `?series=` query value. Returns null for missing/malformed input
 * (empty string, no colon, empty side) rather than throwing — callers fall back
 * to a default series. */
export function parseSeriesParam(value: string | undefined): SeriesKey | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const [materialCode, plantCode] = parts;
  if (!materialCode || !plantCode) return null;
  return { materialCode, plantCode };
}

export function seriesEquals(a: SeriesKey, b: SeriesKey): boolean {
  return a.materialCode === b.materialCode && a.plantCode === b.plantCode;
}
