// Spec §6.7 selection rule, applied to benchmark rows
// { det, rec, longSide, downloadMB, exact, required, meanCer, totalMs }:
// among configurations that read every required label exactly, pick the smallest download,
// then the fastest. Returns null when no configuration reads every label.
export function chooseConfig(rows) {
  const eligible = rows.filter((r) => r.exact === r.required);
  eligible.sort((a, b) => a.downloadMB - b.downloadMB || a.totalMs - b.totalMs);
  return eligible[0] ?? null;
}
