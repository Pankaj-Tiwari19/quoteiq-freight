"use client";
// Dependency-free SVG bar/line chart for analyst answers. Values are whatever the analyst tool passed in; nothing is recomputed here.
export default function MiniChart({ type, title, labels, series, y_label }: { type: "bar" | "line"; title: string; labels: string[]; series: { name: string; values: (number | null)[] }[]; y_label?: string }) {
  const W = 640, H = 260, L = 56, R = 12, T = 28, B = 46; const iw = W - L - R, ih = H - T - B;
  const all = series.flatMap(s => s.values).filter((v): v is number => v != null); const max = Math.max(1, ...all); const n = labels.length || 1;
  const colors = ["#146c74", "#b7791f", "#b03a2e", "#2f7d4b", "#5d6b78", "#8c5e2a"];
  const x = (i: number, k = 0) => L + (i + 0.5) * (iw / n) + (type === "bar" ? (k - (series.length - 1) / 2) * (iw / n / (series.length + 1)) : 0);
  const y = (v: number) => T + ih - (v / max) * ih;
  const fmt = (v: number) => v >= 1e5 ? (v / 1e5).toFixed(1) + "L" : v >= 1000 ? (v / 1000).toFixed(0) + "k" : String(Math.round(v * 100) / 100);
  return (<svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, margin: "8px 0" }} role="img" aria-label={title}>
    <text x={L} y={16} fontSize={13} fontWeight={600} fill="var(--ink)">{title}</text>
    {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#eceee8" /><text x={L - 6} y={y(max * f) + 4} fontSize={10} textAnchor="end" fill="#5d6b78">{fmt(max * f)}</text></g>)}
    {y_label && <text x={8} y={T + ih / 2} fontSize={10} fill="#5d6b78" transform={`rotate(-90 8 ${T + ih / 2})`} textAnchor="middle">{y_label}</text>}
    {series.map((s, k) => type === "bar"
      ? s.values.map((v, i) => v == null ? null : <rect key={i} x={x(i, k) - iw / n / (series.length + 1) / 2} y={y(v)} width={iw / n / (series.length + 1)} height={ih - (y(v) - T)} fill={colors[k % colors.length]}><title>{s.name}: {labels[i]} = {v}</title></rect>)
      : <polyline key={k} fill="none" stroke={colors[k % colors.length]} strokeWidth={2} points={s.values.map((v, i) => v == null ? "" : `${x(i)},${y(v)}`).filter(Boolean).join(" ")} />)}
    {labels.map((l, i) => <text key={i} x={x(i)} y={H - B + 14} fontSize={10} textAnchor="middle" fill="#5d6b78">{l.length > 12 ? l.slice(0, 11) + "…" : l}</text>)}
    {series.length > 1 && series.map((s, k) => <g key={k}><rect x={L + k * 120} y={H - 14} width={10} height={10} fill={colors[k % colors.length]} /><text x={L + k * 120 + 14} y={H - 5} fontSize={10} fill="#5d6b78">{s.name}</text></g>)}
  </svg>);
}
