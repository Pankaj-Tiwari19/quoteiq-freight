"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { NormalizedLine, Rfq, VendorSummary } from "@/lib/types";
import { inr, inr0, unitLabel, reasonLabel } from "@/lib/format";
export default function ComparisonTable({ rfq, summaries, normalized }: { rfq: Rfq; summaries: VendorSummary[]; normalized: NormalizedLine[] }) {
  const sp = useSearchParams();
  const [vendorF, setVendorF] = useState("all"); const [qualityF, setQualityF] = useState("all"); const [excF, setExcF] = useState("all");
  const [basis, setBasis] = useState<"comparable" | "converted">("comparable"); const [skuF, setSkuF] = useState(sp.get("sku") ?? "");
  const vendors = summaries.filter(s => s.extracted && (vendorF === "all" || s.vendor_id === vendorF) && (qualityF === "all" || (qualityF === "pass") === s.quality.passed_mandatory));
  const byKey = useMemo(() => new Map(normalized.map(n => [n.vendor_id + n.sku, n])), [normalized]);
  const val = (n?: NormalizedLine) => n ? (basis === "comparable" ? n.comparable_value : n.normalized_value) : null;
  const rows = rfq.lines.filter(l => !skuF || l.sku.includes(skuF.toUpperCase())).map(l => {
    const cells = vendors.map(v => byKey.get(v.vendor_id + l.sku));
    const usable = cells.filter(c => c && val(c) != null && !c.review_required && summaries.find(s => s.vendor_id === c.vendor_id)!.quality.passed_mandatory) as NormalizedLine[];
    const best = usable.length ? usable.reduce((a, b) => val(a)! < val(b)! ? a : b) : null;
    return { line: l, cells, best };
  }).filter(r => excF === "all" || (excF === "review" && r.cells.some(c => c?.review_required && !c.review_reasons.includes("missing_quote"))) || (excF === "missing" && r.cells.some(c => !c || c.review_reasons.includes("missing_quote"))) || (excF === "nobest" && !r.best));
  const totals = vendors.map(v => { const ls = normalized.filter(n => n.vendor_id === v.vendor_id && val(n) != null); return { v, total: ls.reduce((s, n) => s + val(n)! * rfq.lines.find(l => l.sku === n.sku)!.quantity, 0), count: ls.length }; });
  return (<>
    <div className="filters">
      <select value={vendorF} onChange={e => setVendorF(e.target.value)}><option value="all">All vendors</option>{summaries.map(s => <option key={s.vendor_id} value={s.vendor_id}>{s.name}</option>)}</select>
      <select value={qualityF} onChange={e => setQualityF(e.target.value)}><option value="all">Any quality status</option><option value="pass">Passes mandatory quality</option><option value="fail">Fails mandatory quality</option></select>
      <select value={excF} onChange={e => setExcF(e.target.value)}><option value="all">All lanes</option><option value="review">Lanes with values under review</option><option value="missing">Lanes with missing quotes</option><option value="nobest">Lanes without a defensible best rate</option></select>
      <select value={basis} onChange={e => setBasis(e.target.value as any)}><option value="comparable">Comparable (all-in only)</option><option value="converted">All converted (incl. freight-only – not comparable)</option></select>
      <input type="text" placeholder="Lane filter e.g. L0" value={skuF} onChange={e => setSkuF(e.target.value)} />
      <span style={{ color: "var(--muted)" }}>{rows.length} lanes</span>
    </div>
    <div className="panel compare-wrap" style={{ padding: 0 }}><table className="compare"><thead><tr><th>Lane</th><th>Unit</th><th className="num">Qty/yr</th>{vendors.map(v => <th key={v.vendor_id} className="num">{v.name}<br /><small style={{ fontWeight: 400 }}>{v.quality.passed_mandatory ? <span className="tag pass">quality pass</span> : <span className="tag fail">quality fail</span>} {v.lines_quoted}/{rfq.lines.length} · {v.basis === "all_in" ? "all-in" : v.basis === "freight_only" ? "freight only" : v.basis}</small></th>)}<th>Best (questionnaire-passing, comparable, no review)</th></tr></thead><tbody>
      {rows.map(({ line, cells, best }) => <tr key={line.sku}><td className="mono" title={line.description}>{line.sku} <small style={{ fontWeight: 400, color: "var(--muted)" }}>{line.description}</small></td><td><small>{line.mode} {line.uom}</small></td><td className="num">{line.quantity.toLocaleString("en-IN")}</td>
        {cells.map((c, i) => { const v = vendors[i]; const price = val(c); const missing = !c || c.review_reasons.includes("missing_quote"); const rev = c?.review_required && !missing;
          const title = c ? `As quoted: ${c.original_value ?? "—"} ${c.original_currency} ${unitLabel(c.original_unit)} (${c.basis.replace("_", " ")})\nEvidence: ${c.source_document} – ${c.source_location}\n“${c.raw_text}”\nConfidence: ${c.confidence_label}\n${c.assumptions.length ? "Assumptions: " + c.assumptions.join("; ") + "\n" : ""}${c.review_reasons.map(r => reasonLabel[r]).join(", ")}${c.review_note ? "\n" + c.review_note : ""}\n${c.calculation_trace.join("\n")}` : "";
          return <td key={v.vendor_id} className={`num ${rev ? "cell-review" : ""} ${best && c === best ? "cell-best" : ""}`} title={title}>
            {missing ? <span className="cell-missing">not quoted</span> : price == null ? <span className="tag review">{c!.review_reasons.map(r => reasonLabel[r]).join(", ")}{c!.normalized_value != null && <> · {inr(c!.normalized_value)} as converted</>}</span> : <><span className={!v.quality.passed_mandatory ? "cell-fail" : ""} style={c!.assumptions.length ? { textDecoration: "underline dotted", textUnderlineOffset: 3 } : undefined}>{inr(price)}</span>{rev && <><br /><small style={{ color: "var(--review)" }}>{c!.review_reasons.map(r => reasonLabel[r]).join(", ")}</small></>}</>}
          </td>; })}
        <td>{best ? <>{summaries.find(s => s.vendor_id === best.vendor_id)!.name} · {inr(val(best))}</> : <span className="tag review">needs review</span>}</td></tr>)}
      <tr><td colSpan={3}><b>Annual total over comparable lanes</b></td>{totals.map(t => <td key={t.v.vendor_id} className="num"><b>{inr0(t.total)}</b><br /><small>{t.count}/{rfq.lines.length} lanes</small></td>)}<td /></tr>
    </tbody></table></div>
  </>);
}
