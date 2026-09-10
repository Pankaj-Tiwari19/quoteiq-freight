import Link from "next/link";
import { buildDataset } from "@/lib/normalize";
import { buildRecommendation } from "@/lib/analyst";
import { decisionsLog as A_decisions } from "@/lib/analytics";
import { inr, inr0, pct, reasonLabel } from "@/lib/format";
import MemoButton from "@/components/MemoButton";
export const dynamic = "force-dynamic";
export default function Award() {
  const ds = buildDataset();
  if (!ds.summaries.some(s => s.extracted)) return <><h1>Award recommendation</h1><div className="empty">Extract vendor responses first.</div></>;
  const r = buildRecommendation(ds); const s = r.strict; const name = (id: string | null) => ds.vendors.find(v => v.id === id)?.name ?? "—";
  const alloc = Object.entries(s.allocation).sort((a, b) => b[1].total_inr - a[1].total_inr);
  const notExtracted = ds.summaries.filter(x => !x.extracted);
  return (<>
    <h1>Award recommendation</h1>
    <p className="sub">Recommended strategy: split the award lane-by-lane among suppliers that pass the mandatory questionnaire criteria, using only comparable all-in values that need no human review (or that the buyer has accepted). Figures are annual INR at the frozen FX rate, after programme-level rebates where the TEU threshold is met. Freight-only quotes are never ranked. <a className="btn" href="/api/export" style={{ marginLeft: 8, padding: "4px 10px", fontSize: 12 }}>Export to Excel</a></p>
    <div className="callout" style={{ marginTop: 0 }}><b>AI recommends. The buyer approves.</b> This recommendation is computed from extracted data and is only as good as the extractions behind it. Resolve the exceptions below before award.</div>
    <div className="stats">
      <div className="stat"><b>{inr0(s.split_total_inr)}</b><small>recommended split award ({s.lines_covered}/{ds.rfq.lines.length} lanes)</small></div>
      <div className="stat"><b>{s.best_single_vendor ? inr0(s.best_single_vendor.total_inr) : "—"}</b><small>best single complete supplier on the same lanes ({s.best_single_vendor?.name ?? "none complete"})</small></div>
      <div className="stat"><b style={{ color: "var(--pass)" }}>{inr0(s.savings_inr)}</b><small>estimated saving from splitting ({pct(s.savings_percent)})</small></div>
      <div className="stat"><b>{inr0(r.withReview.split_total_inr)}</b><small>if all review items are confirmed as read ({r.withReview.lines_covered} lanes)</small></div>
      <div className="stat"><b>{r.unconstrained.savings_inr != null && s.savings_inr != null ? inr0(r.unconstrained.split_total_inr) : "—"}</b><small>if questionnaire failures were ignored (not recommended)</small></div>
    </div>
    <div className="two">
      <div className="panel"><h2 style={{ marginTop: 0 }}>Supplier allocation</h2><table><thead><tr><th>Supplier</th><th className="num">Lanes</th><th className="num">Value</th><th className="num">Share</th></tr></thead><tbody>
        {alloc.map(([vid, a]) => <tr key={vid}><td>{name(vid)}<br /><small className="mono">{a.lines.join(", ")}</small></td><td className="num">{a.lines.length}</td><td className="num">{inr0(a.total_inr)}</td><td className="num">{pct(a.total_inr / s.split_total_inr * 100)}</td></tr>)}
      </tbody></table>
      <h2>Supplier totals (questionnaire-passing, comparable, no review)</h2><table><thead><tr><th>Supplier</th><th className="num">Comparable lanes</th><th className="num">Total</th></tr></thead><tbody>
        {s.vendor_totals.map(t => <tr key={t.vendor_id}><td>{t.name} {t.complete ? <span className="tag pass">complete</span> : <span className="tag muted">partial</span>}</td><td className="num">{t.lines_priced}/{t.lines_total}</td><td className="num">{inr0(t.total_inr)}</td></tr>)}
      </tbody></table></div>
      <div className="panel"><h2 style={{ marginTop: 0 }}>Exceptions the buyer must resolve</h2>
        {notExtracted.length > 0 && <div className="callout fail">Not extracted: {notExtracted.map(x => x.name).join(", ")}. The recommendation ignores them.</div>}
        {r.quality.filter(q => q.assessed && !q.passed_mandatory).map(q => <div key={q.vendor_id} className="callout fail"><b>{q.name}</b> excluded: {q.failed.length ? `mandatory not met – ${q.failed.join(", ")}` : ""}{q.needs_review.length ? ` unconfirmed "yes" on ${q.needs_review.join(", ")} (resolve on the vendor page)` : ""}. {r.unconstrained.savings_inr != null && s.savings_inr != null && r.unconstrained.split_total_inr < s.split_total_inr && <>Including them would lower the total by {inr0(s.split_total_inr - r.unconstrained.split_total_inr)}; a waiver would need justification.</>}</div>)}
        {s.lines_uncovered.length > 0 && <div className="callout">No defensible rate for <span className="mono">{s.lines_uncovered.join(", ")}</span>: every questionnaire-passing quote is missing, non-comparable or under review. See lane detail below.</div>}
        {r.withReview.lines_in_split_needing_review.length > 0 && <div className="callout">Values under review that would change the award if confirmed: <span className="mono">{r.withReview.lines_in_split_needing_review.join(", ")}</span>. Confirm them on the vendor page before relying on them.</div>}
        {A_decisions(ds).length > 0 && <div className="callout pass"><b>{A_decisions(ds).length} buyer decisions</b> are reflected in these figures: {A_decisions(ds).map(d => `${name(d.vendor_id)} ${d.target} ${d.action}`).join("; ")}. Full log on the Trust page.</div>}
        <h2>Risk register</h2>
        <table><thead><tr><th>Severity</th><th>Vendor</th><th>Risk</th><th>Evidence</th></tr></thead><tbody>
          {r.risks.map((k, i) => <tr key={i}><td><span className={`tag ${k.severity === "high" ? "fail" : k.severity === "medium" ? "review" : "muted"}`}>{k.severity}</span></td><td>{name(k.vendor_id)}</td><td>{k.risk}</td><td><small>{k.evidence}</small></td></tr>)}
        </tbody></table>
      </div>
    </div>
    <h2>Recommendation memo</h2>
    <div className="panel"><MemoButton /></div>
    <h2>Lane-by-lane recommendation</h2>
    <div className="panel"><table><thead><tr><th>Lane</th><th className="num">Qty/yr</th><th>Recommended supplier</th><th className="num">₹ / unit</th><th className="num">Annual ₹</th><th>Runner-up</th><th>Excluded / under review</th></tr></thead><tbody>
      {r.perLine.map(p => { const rv = ds.normalized.filter(n => n.sku === p.sku && n.review_required && !n.review_reasons.includes("missing_quote")); return <tr key={p.sku} className={p.vendor_id ? "" : "cell-review"}>
        <td className="mono"><Link href={`/comparison?sku=${p.sku}`}>{p.sku}</Link></td><td className="num">{p.quantity.toLocaleString("en-IN")}</td>
        <td>{p.vendor_id ? name(p.vendor_id) : <span className="tag review">needs review</span>}</td><td className="num">{inr(p.unit_price_inr)}</td><td className="num">{inr0(p.line_total_inr)}</td>
        <td>{p.runner_up ? `${name(p.runner_up.vendor_id)} · ${inr(p.runner_up.unit_price_inr)}` : "—"}</td>
        <td><small>{[...rv.map(n => `${name(n.vendor_id)}: ${n.review_reasons.map(x => reasonLabel[x]).join(", ")}`), ...p.excluded.filter(e => !rv.some(n => n.vendor_id === e.vendor_id)).map(e => `${name(e.vendor_id)}: ${e.why}`)].join("; ")}{p.assumptions.length ? ` · assumes ${p.assumptions.join("; ")}` : ""}</small></td></tr>; })}
    </tbody></table></div>
  </>);
}
