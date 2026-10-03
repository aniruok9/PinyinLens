// Share of all labelled phrases a configuration must read exactly (spec success criterion 5).
export const MIN_EXACT_SHARE = 0.9;

// Spec §6.7 selection rule, applied to benchmark rows
// { det, rec, longSide, downloadMB, exact, required, meanCer, totalMs }:
// among configurations that read at least MIN_EXACT_SHARE of all labels exactly, pick the fastest
// (lowest totalMs), then the smaller download. Returns null when no configuration qualifies.
export function chooseConfig(rows) {
  const eligible = rows.filter((r) => r.exact >= MIN_EXACT_SHARE * r.required);
  eligible.sort((a, b) => a.totalMs - b.totalMs || a.downloadMB - b.downloadMB);
  return eligible[0] ?? null;
}
