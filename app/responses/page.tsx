import Link from "next/link";
import { buildDataset } from "@/lib/normalize";
import { fmtLabel } from "@/lib/format";
import ExtractButton from "@/components/ExtractButton";
export const dynamic = "force-dynamic";
export default function Responses() {
  const ds = buildDataset();
  return (<>
    <h1>Supplier responses</h1>
    <p className="sub">Each response is read by the extraction model exactly as it arrived (Excel, PDF, Word, a phone photo, an email) into a structured record: rate as written, currency and unit as stated, inclusions/exclusions, footnotes as conditions. Every value keeps its evidence and a confidence label. Nothing is converted here. The original document is never modified.</p>
    {!ds.summaries.some(s => s.extracted) && <div className="callout">No responses have been extracted yet. Run extraction below (needs a Gemini key in .env.local), <code>npm run extract</code>, or import an existing run with <code>npm run import-extraction -- &lt;file&gt;</code>.</div>}
    <div className="panel"><table><thead><tr><th>Vendor</th><th>Source file</th><th>Status</th><th className="num">Lanes</th><th className="num">Review</th><th>Model</th><th></th></tr></thead><tbody>
      {ds.summaries.map(s => { const v = ds.vendors.find(x => x.id === s.vendor_id)!; const ex = ds.extractions[s.vendor_id]; return <tr key={s.vendor_id}>
        <td><Link href={`/responses/${s.vendor_id}`}>{s.name}</Link></td>
        <td><span className="tag kraft">{fmtLabel[v.response_format]}</span> <a href={`/api/docs/${v.file}`} target="_blank">{v.file}</a></td>
        <td>{s.extracted ? <span className="tag pass">Extracted {ex.extracted_at.slice(0, 16).replace("T", " ")}</span> : <span className="tag muted">Not extracted</span>}</td>
        <td className="num">{s.extracted ? s.lines_quoted : "—"}</td><td className="num">{s.extracted ? s.lines_needing_review.length : "—"}</td><td className="mono">{ex?.model ?? "—"}</td>
        <td><ExtractButton vendorId={s.vendor_id} label={s.extracted ? "Re-extract" : "Extract"} /></td>
      </tr>; })}
    </tbody></table>
    <div style={{ marginTop: 12 }}><ExtractButton vendorId="all" label="Extract all suppliers" /></div></div>
  </>);
}
