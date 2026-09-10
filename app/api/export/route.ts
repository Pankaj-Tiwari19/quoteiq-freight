// Excel export of the comparison: comparable, all converted, as quoted, provenance (evidence + assumptions), questionnaire, award, decisions.
// Every number carries its review status so the export can't launder an unconfirmed value into a clean-looking cell.
import * as XLSX from "xlsx";
import { buildDataset } from "@/lib/normalize";
import { buildRecommendation } from "@/lib/analyst";
import { decisionsLog } from "@/lib/analytics";
import { reasonLabel, basisLabel } from "@/lib/format";
export const dynamic = "force-dynamic";
export async function GET() {
  const ds = buildDataset(); const vs = ds.summaries.filter(s => s.extracted); const wb = XLSX.utils.book_new();
  const grid = (pick: (n: any) => any) => [["Lane", "Route", "Mode", "Unit", "Qty/yr", ...vs.map(v => v.name), "Best (questionnaire pass, comparable, no review)"], ...ds.rfq.lines.map(l => {
    const cells = vs.map(v => ds.normalized.find(n => n.vendor_id === v.vendor_id && n.sku === l.sku)!);
    const usable = cells.filter(c => c.comparable_value != null && !c.review_required && vs.find(v => v.vendor_id === c.vendor_id)!.quality.passed_mandatory);
    const best = usable.length ? usable.reduce((a, b) => a.comparable_value! < b.comparable_value! ? a : b) : null;
    return [l.sku, l.description, l.mode, l.uom, l.quantity, ...cells.map(pick), best ? `${vs.find(v => v.vendor_id === best.vendor_id)!.name} ${best.comparable_value}` : "NEEDS REVIEW"]; })];
  const mark = (n: any, v: number | null) => v == null ? (n.review_reasons.includes("missing_quote") ? "not quoted" : `REVIEW: ${n.review_reasons.map((r: string) => reasonLabel[r]).join(", ")}`) : n.review_required ? `${v} (REVIEW)` : v;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid(n => mark(n, n.comparable_value))), "Comparable INR per unit");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid(n => mark(n, n.normalized_value))), "All converted (incl. non-comp)");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid(n => n.original_value == null ? (n.review_reasons.includes("missing_quote") ? "—" : reasonLabel[n.review_reasons[0]] ?? "—") : `${n.original_value} ${n.original_currency} ${n.original_unit} (${basisLabel[n.basis]})`)), "As quoted");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "Lane", "Original", "Currency", "Unit as stated", "Basis", "Converted INR/unit", "Comparable INR/unit", "FX", "Assumptions", "Confidence", "Review", "Reasons", "Source doc", "Location", "Excerpt", "Trace", "Decision"],
    ...ds.normalized.filter(n => !n.review_reasons.includes("missing_quote")).map(n => [vs.find(v => v.vendor_id === n.vendor_id)?.name, n.sku, n.original_value, n.original_currency, n.original_unit, basisLabel[n.basis], n.normalized_value, n.comparable_value, n.fx_rate_applied, n.assumptions.join("; "), n.confidence_label, n.review_required ? "yes" : "no", n.review_reasons.map(r => reasonLabel[r]).join("; "), n.source_document, n.source_location, n.raw_text, n.calculation_trace.join(" → "), n.decision ? `${n.decision.action}: ${n.decision.reason}` : ""])]), "Provenance & assumptions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "Lane", "State", "Why", "As quoted", "Evidence"], ...ds.normalized.filter(n => n.review_required || n.comparable_value == null).map(n => [vs.find(v => v.vendor_id === n.vendor_id)?.name, n.sku, n.review_reasons.map(r => reasonLabel[r]).join("; "), n.review_note, n.original_value == null ? "" : `${n.original_value} ${n.original_currency} ${n.original_unit}`, `${n.source_document} – ${n.source_location}`])]), "Uncertainties");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "Criterion", "Mandatory", "Answer text", "Read as", "Confidence", "Evidence", "Decision"], ...ds.summaries.flatMap(s => s.quality.answers.map(a => [s.name, a.label, a.mandatory ? "yes" : "no", a.answer_text, a.interpreted, a.confidence, a.source_location, a.decision?.action ?? ""]))]), "Questionnaire");
  const rec = buildRecommendation(ds);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Lane", "Route", "Unit", "Qty/yr", "Recommended supplier", "INR/unit", "Annual INR", "Assumptions", "Runner-up", "Runner-up INR/unit", "Excluded"], ...rec.perLine.map(p => [p.sku, p.lane, p.unit, p.quantity, p.vendor_id ? vs.find(v => v.vendor_id === p.vendor_id)?.name : "NEEDS REVIEW", p.unit_price_inr, p.line_total_inr, p.assumptions.join("; "), p.runner_up ? vs.find(v => v.vendor_id === p.runner_up!.vendor_id)?.name : "", p.runner_up?.unit_price_inr ?? "", p.excluded.map(e => `${vs.find(v => v.vendor_id === e.vendor_id)?.name}: ${e.why}`).join("; ")]), [], ["Split total (questionnaire pass, comparable, no review)", rec.strict.split_total_inr], ["Best single complete supplier on same lanes", rec.strict.best_single_vendor?.name, rec.strict.best_single_vendor?.total_inr], ["Saving", rec.strict.savings_inr], ["FX USD/INR", ds.rfq.fx.USD_INR, ds.rfq.fx.source, ds.rfq.fx.as_of], ["Programme TEU", ds.programme_teu]]), "Award");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Supplier", "Target", "Action", "Original", "Override", "Reason", "By", "When"], ...decisionsLog(ds).map(d => [vs.find(v => v.vendor_id === d.vendor_id)?.name, d.target, d.action, d.original_value, d.override_value, d.reason, d.decided_by, d.decided_at])]), "Buyer decisions");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${ds.rfq.rfq_id}_comparison.xlsx"` } });
}
