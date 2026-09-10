import { buildDataset } from "@/lib/normalize";
import ComparisonTable from "@/components/ComparisonTable";
export const dynamic = "force-dynamic";
export default function Comparison() {
  const ds = buildDataset();
  if (!ds.summaries.some(s => s.extracted)) return <><h1>Comparison</h1><div className="empty">Extract at least one vendor response first.</div></>;
  return (<>
    <h1>Comparison · {ds.rfq.lines.length} lanes × {ds.vendors.length} suppliers</h1>
    <p className="sub">INR per RFQ unit (20GP / 40HC / CBM / kg): rate as quoted → unit basis (20'/40' variants, w/m at declared density) → USD→INR at the frozen rate → programme-level rebate where the TEU threshold is met. Freight-only and partial-basis quotes are shown but never compared or ranked. Amber cells need a person before they can be relied on; struck-through suppliers fail mandatory questionnaire criteria. Hover a cell for the original quote, evidence, confidence and every assumption. <a className="btn" href="/api/export" style={{ marginLeft: 8, padding: "4px 10px", fontSize: 12 }}>Export to Excel</a></p>
    <ComparisonTable rfq={ds.rfq} summaries={ds.summaries} normalized={ds.normalized} />
  </>);
}
