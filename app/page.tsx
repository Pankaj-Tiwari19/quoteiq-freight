import Link from "next/link";
import { buildDataset } from "@/lib/normalize";
import { fmtLabel, basisLabel } from "@/lib/format";
export const dynamic = "force-dynamic";
export default function Overview() {
  const ds = buildDataset(); const r = ds.rfq;
  const extracted = ds.summaries.filter(s => s.extracted).length;
  return (<>
    <h1>{r.rfq_id} · {r.title}</h1>
    <p className="sub">{r.category}. Issued {r.issued_on}, responses due {r.due_on}. {r.incoterm} Max transit {r.max_transit_days ?? "—"} days. Programme volume {ds.programme_teu} TEU (40HC = 2 TEU). Evaluation currency INR; USD converted at {r.fx.USD_INR ?? "— (not entered)"} ({r.fx.source}, {r.fx.as_of}).</p>
    <div className="stats">
      <div className="stat"><b>{r.lines.length}</b><small>lanes requested</small></div>
      <div className="stat"><b>{ds.vendors.length}</b><small>suppliers responded</small></div>
      <div className="stat"><b>{extracted}/{ds.vendors.length}</b><small>responses extracted</small></div>
      <div className="stat"><b>{ds.summaries.filter(s => s.quality.passed_mandatory).length}</b><small>pass mandatory quality</small></div>
      <div className="stat"><b>{ds.normalized.filter(n => n.review_required && !n.review_reasons.includes("missing_quote")).length}</b><small>values need review</small></div>
      <div className="stat"><b>{ds.normalized.filter(n => n.decision).length + ds.summaries.flatMap(s => s.quality.answers).filter(a => a.decision).length}</b><small>buyer decisions recorded</small></div>
    </div>
    <h2>Status: {r.status}</h2>
    <div className="panel"><table><thead><tr><th>Vendor</th><th>Format</th><th>Received</th><th>Extraction</th><th className="num">Lines quoted</th><th className="num">Need review</th><th>Currency</th><th>Basis</th><th>Discount</th><th>Questionnaire</th></tr></thead><tbody>
      {ds.summaries.map(s => <tr key={s.vendor_id}>
        <td><Link href={`/responses/${s.vendor_id}`}>{s.name}</Link></td><td><span className="tag kraft">{fmtLabel[s.format]}</span></td>
        <td>{ds.vendors.find(v => v.id === s.vendor_id)?.received_on}</td>
        <td>{s.extracted ? <span className="tag pass">Extracted</span> : <span className="tag muted">Not yet</span>}</td>
        <td className="num">{s.extracted ? `${s.lines_quoted}/${r.lines.length}` : "—"}</td><td className="num">{s.extracted ? s.lines_needing_review.length : "—"}</td>
        <td>{s.currency}</td><td>{s.extracted ? <span className={`tag ${s.basis === "all_in" ? "pass" : s.basis === "unstated" ? "muted" : "review"}`}>{basisLabel[s.basis]}</span> : "—"}</td><td>{s.discount ? <>{s.discount.pct}% {s.discount.applied ? <span className="tag pass">applied</span> : <span className="tag review">not applied</span>}</> : s.extracted ? "—" : ""}</td>
        <td>{!s.quality.assessed ? <span className="tag muted">after extraction</span> : s.quality.passed_mandatory ? <span className="tag pass">Pass</span> : s.quality.failed_criteria.length ? <span className="tag fail">Fails: {s.quality.failed_criteria.join(", ")}</span> : <span className="tag review">Confirm: {s.quality.criteria_needing_review.join(", ")}</span>}</td>
      </tr>)}
    </tbody></table></div>
    <h2>Requested lanes (RFQ truth)</h2>
    <div className="panel"><table><thead><tr><th>Lane</th><th>Route</th><th>Mode</th><th>Unit</th><th className="num">Annual volume</th><th className="num">Density kg/CBM</th></tr></thead><tbody>
      {r.lines.map(l => <tr key={l.sku}><td className="mono">{l.sku}</td><td>{l.description}</td><td>{l.mode}</td><td>{l.uom}</td><td className="num">{l.quantity.toLocaleString("en-IN")}</td><td className="num">{l.cargo_density_kg_per_cbm ?? "—"}</td></tr>)}
    </tbody></table></div>
  </>);
}
