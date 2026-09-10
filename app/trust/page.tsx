import fs from "fs";
import path from "path";
import Link from "next/link";
import { buildDataset, LOW_CONFIDENCE } from "@/lib/normalize";
import { decisionsLog } from "@/lib/analytics";
import { inr0, reasonLabel } from "@/lib/format";
export const dynamic = "force-dynamic";

function readJson(p: string) { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), p), "utf8")); } catch { return null; } }

export default function Trust() {
  const ds = buildDataset(); const evalRun = readJson("data/eval/latest.json");
  const priced = ds.normalized.filter(n => n.original_value != null);
  const bands = [["≥ 95%", (c: number) => c >= 0.95], ["80–95%", (c: number) => c >= LOW_CONFIDENCE && c < 0.95], ["50–80%", (c: number) => c >= 0.5 && c < LOW_CONFIDENCE], ["< 50%", (c: number) => c < 0.5]] as const;
  const counts = bands.map(([l, f]) => ({ label: l, n: priced.filter(p => f(p.confidence)).length }));
  const reasons = Object.entries(ds.normalized.flatMap(n => n.review_reasons.filter(r => r !== "missing_quote")).reduce<Record<string, number>>((a, r) => (a[r] = (a[r] ?? 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
  const decisions = decisionsLog(ds); const name = (id: string) => ds.vendors.find(v => v.id === id)?.name ?? id;
  const usable = ds.normalized.filter(n => n.comparable_value != null && !n.review_required).length;
  const strictValue = ds.rfq.lines.reduce((s, l) => { const c = ds.normalized.filter(n => n.sku === l.sku && n.comparable_value != null && !n.review_required && ds.summaries.find(x => x.vendor_id === n.vendor_id)!.quality.passed_mandatory); return s + (c.length ? Math.min(...c.map(n => n.comparable_value!)) * l.quantity : 0); }, 0);
  return (<>
    <h1>Trust &amp; audit</h1>
    <p className="sub">Why a buyer should believe the numbers on the other screens. Everything here is computed from the same dataset; nothing is a claim.</p>

    <h2>1 · How accurate is the extraction?</h2>
    <div className="panel">
      {evalRun ? <div className="stats">
        <div className="stat"><b>{evalRun.lines.ok}/{evalRun.lines.total}</b><small>lane rates exactly right (value, unit family, currency) vs answer key</small></div>
        <div className="stat"><b>{evalRun.flags.ok}/{evalRun.flags.total}</b><small>flags right: missing, illegible, ambiguous lanes</small></div>
        <div className="stat"><b className="mono" style={{ fontSize: 14 }}>{evalRun.model ?? "—"}</b><small>model · {evalRun.run_at?.slice(0, 16).replace("T", " ")}</small></div>
      </div> : <div className="callout">No evaluation run yet. After extraction, run <code>npm run eval</code>: it scores every extracted lane rate and flag against the answer key generated with the documents (<span className="mono">data/ground_truth.json</span>). The score appears here.</div>}
      <p className="sub" style={{ margin: "12px 0 0", fontSize: 13 }}>The answer key is produced by the same script that produces the vendor documents, so it is exact by construction. This is how you would tune prompts before trusting the pipeline on real vendors, and how you would detect a model regression after switching providers.</p>
    </div>

    <h2>2 · How sure is the model, value by value?</h2>
    <div className="two">
      <div className="panel">
        <table><thead><tr><th>Extraction confidence</th><th className="num">Values</th><th style={{ width: "40%" }} /></tr></thead><tbody>
          {counts.map(c => <tr key={c.label}><td>{c.label}</td><td className="num">{c.n}</td><td><div className="bar"><i style={{ width: `${priced.length ? (c.n / priced.length) * 100 : 0}%`, background: c.label.startsWith("≥") ? "var(--pass)" : c.label.startsWith("80") ? "var(--primary)" : "var(--review)" }} /></div></td></tr>)}
        </tbody></table>
        <p className="sub" style={{ margin: "10px 0 0", fontSize: 13 }}>Values the extractor labelled “low” (illegible digits, non-standard labels) are excluded from the recommendation until a person confirms them; "medium" is shown but flagged in the risk register. Self-reported confidence is imperfect; the answer-key score above is the check on it.</p>
      </div>
      <div className="panel">
        <table><thead><tr><th>Why values are held for review</th><th className="num">Count</th></tr></thead><tbody>
          {reasons.map(([r, n]) => <tr key={r}><td>{reasonLabel[r] ?? r}</td><td className="num">{n}</td></tr>)}
          {!reasons.length && <tr><td colSpan={2} className="cell-missing">Nothing under review.</td></tr>}
        </tbody></table>
        <p className="sub" style={{ margin: "10px 0 0", fontSize: 13 }}>{usable} of {priced.length} priced values are usable without review; the strict recommendation is built only from those.</p>
      </div>
    </div>

    <h2>3 · What is assumed?</h2>
    <div className="panel"><table><tbody>
      <tr><td style={{ width: 240 }}>Currency conversion</td><td>USD → INR at <b>{ds.rfq.fx.USD_INR ?? "— (not entered: USD quotes stay non-comparable)"}</b>, {ds.rfq.fx.source}, {ds.rfq.fx.as_of}. Frozen so every supplier is compared at the same rate; recorded as an assumption on every converted cell. Applied in code, never by the model. ±5% sensitivity is a query the analyst can run.</td></tr>
      <tr><td>Unit basis</td><td>A vendor's “20'” / “40'” is read as 20GP / 40HC with a recorded assumption. “Per w/m” converts to per CBM using the lane's declared density (weight governs above 1000 kg/CBM). A 20' quote on a 40HC lane, or any unit the extractor could not classify, is <i>not</i> converted and is held for review.</td></tr>
      <tr><td>Basis</td><td>Freight-only or partial quotes (THC, documentation extra) are converted for information but never compared with all-in quotes and never ranked. A like-for-like number needs the supplier's surcharge schedule.</td></tr>
      <tr><td>Volume discounts</td><td>Read at programme level: the total committed TEU across FCL lanes ({ds.programme_teu} TEU; 40HC = 2 TEU). A TEU-denominated rebate whose threshold the programme clears is applied to FCL lanes and recorded as an assumption on each cell; any other discount wording is shown in the risk register, never applied.</td></tr>
      <tr><td>Questionnaire gate</td><td>Answers are read from the supplier's own response; pass/fail is decided by the RFQ's rules in code (ISO 9001 yes/no, insurance ≥ USD 1M). Cross-currency or hedged answers are “partial” = not met until the buyer records a decision. A supplier is eligible only when every mandatory criterion is a confident “yes” (≥ {Math.round(LOW_CONFIDENCE * 100)}%) or the buyer has decided.</td></tr>
      <tr><td>Lane matching</td><td>Vendors use their own lane labels (“NSA-JEA”, “the Jebel Ali 20s”). When one label could fit two lanes the extractor assigns neither and the cell reads “check lane match”.</td></tr>
      <tr><td>Missing is not zero</td><td>Unquoted lanes, prior-rate references (“same as last year + 3%”) and illegible cells never enter a total. A supplier's total is shown over the lanes it priced comparably, with the count beside it.</td></tr>
    </tbody></table></div>

    <h2>4 · What has the buyer decided?</h2>
    <div className="panel">
      {decisions.length === 0 ? <div className="empty">No decisions yet. Flagged values can be accepted, overridden or rejected on each vendor's page; each decision needs a reason and appears here.</div>
        : <table><thead><tr><th>When</th><th>By</th><th>Vendor</th><th>Item</th><th>Action</th><th>Read as</th><th>Decided</th><th>Reason</th></tr></thead><tbody>
          {decisions.sort((a, b) => b.decided_at.localeCompare(a.decided_at)).map((d, i) => <tr key={i}><td className="mono">{d.decided_at.slice(0, 16).replace("T", " ")}</td><td>{d.decided_by}</td><td><Link href={`/responses/${d.vendor_id}`}>{name(d.vendor_id)}</Link></td><td className="mono">{d.target}</td><td><span className={`tag ${d.action === "reject" ? "fail" : d.action === "clarify" ? "muted" : "pass"}`}>{d.action}</span></td><td>{String(d.original_value ?? "—")}</td><td>{d.override_value != null ? String(d.override_value) : "—"}</td><td><small>{d.reason}</small></td></tr>)}
        </tbody></table>}
      <p className="sub" style={{ margin: "10px 0 0", fontSize: 13 }}>Decisions are stored beside the extraction, never over it: the model's reading, the buyer's decision and the reason are all visible in the Excel export. Strict recommendation value as of now: <b>{inr0(strictValue)}</b>.</p>
    </div>
  </>);
}
