"use client";
import { useEffect, useRef, useState } from "react";
type Line = { sku: string; description: string; quantity: number; uom: string };
type Term = { id: string; text: string; status: "proposed" | "approved"; approved_at: string | null; approval_note: string | null };
type OpenQ = { id: string; text: string; about: string };
type Draft = { rfq_id: string; title: string; category: string; incoterm: string; delivery_location: string; max_transit_days: number | null; due_on: string | null; terms: Term[]; quality_questionnaire: { id: string; label: string; mandatory: boolean }[]; lines: Line[]; status: string; issued_on: string | null; sent_to: { vendor_id: string; name: string; email: string; file: string }[]; open_questions: OpenQ[]; revision: number };
type Readiness = { ready: boolean; missing: string[] };
type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; input: any }[] };
const STARTERS = [
  "Load the evaluated RFX-2026-09-FRT into this draft so I can reuse it for next year.",
  "I need annual rates for our 30 freight lanes, same lane list as last year, add an ESG question this time, quotes valid 60 days, INR preferred but USD accepted at our frozen rate. Suppliers must be ISO 9001 with marine cover above USD 1M.",
  "Six new FCL lanes ex Mundra to the Gulf, 40HC, roughly 20 boxes a year each. I'll give exact volumes.",
  "Add four LCL lanes to Singapore and Rotterdam; ask suppliers to quote per CBM – our cargo is about 400 kg per CBM.",
];

export default function DraftCopilot({ vendors }: { vendors: { id: string; name: string; email: string }[] }) {
  const [draft, setDraft] = useState<Draft | null>(null); const [ready, setReady] = useState<Readiness>({ ready: false, missing: [] });
  const [msgs, setMsgs] = useState<Msg[]>([]); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [sel, setSel] = useState<string[]>(vendors.map(v => v.id)); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch("/api/draft").then(r => r.json()).then(j => { setDraft(j.draft); setReady(j.readiness); }); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs.map(m => ({ role: m.role, content: m.content }));
    setMsgs(m => [...m, { role: "user", content: text }]); setQ(""); setBusy(true); setErr("");
    const res = await fetch("/api/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, history }) });
    const j = await res.json(); setBusy(false);
    if (!res.ok) { setErr(j.error); setMsgs(m => [...m, { role: "assistant", content: `Error: ${j.error}` }]); return; }
    setDraft(j.draft); setReady(j.readiness); setMsgs(m => [...m, { role: "assistant", content: j.answer, tools: j.tool_calls }]);
  }
  async function edit(tool: string, input: any) {
    const res = await fetch("/api/draft", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, input }) });
    const j = await res.json(); if (res.ok) { setDraft(j.draft); setReady(j.readiness); } else setErr(j.error);
  }
  async function reset() { if (!confirm("Discard this draft?")) return; const j = await (await fetch("/api/draft", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }) })).json(); setDraft(j.draft); setReady(j.readiness); setMsgs([]); }
  async function send() {
    if (!confirm(`Issue ${draft?.rfq_id} to ${sel.length} vendor(s)? This writes the emails to the outbox.`)) return;
    setBusy(true); const res = await fetch("/api/draft/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_ids: sel }) });
    const j = await res.json(); setBusy(false); if (!res.ok) setErr(j.error); else { setDraft(j.draft); setReady(j.readiness); }
  }
  const issued = draft?.status === "issued";
  return (<div className="two" style={{ gridTemplateColumns: "minmax(360px, 5fr) minmax(420px, 7fr)", alignItems: "start" }}>
    <div className="panel chat" style={{ height: "calc(100vh - 200px)" }}>
      <div className="log">
        {msgs.length === 0 && <div className="empty">Tell the co-pilot what you need to buy. Or start from one of these:</div>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>{m.content}{m.tools && m.tools.length > 0 && <div className="tools">Edits applied: {m.tools.map((t, j) => <code key={j}>{t.name}({summ(t.input)}) </code>)}</div>}</div>)}
        {busy && <div className="msg ai" style={{ color: "var(--muted)" }}>Working…</div>}
        <div ref={end} />
      </div>
      <div>
        {msgs.length === 0 && <div className="suggest">{STARTERS.map(s => <button key={s} onClick={() => ask(s)} disabled={busy || issued}>{s}</button>)}</div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); ask(q); }}><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder={issued ? "RFQ issued – start a new draft to edit" : "e.g. Add a 400x300x250 5-ply carton, qty 12,000"} disabled={issued} /><button type="submit" disabled={busy || issued}>Send</button></form>
        {err && <div style={{ color: "var(--fail)", marginTop: 6, fontSize: 12 }}>{err}</div>}
      </div>
    </div>
    <div>
      {!draft ? <div className="empty">Loading draft…</div> : <>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div><span className="mono" style={{ color: "var(--muted)" }}>{draft.rfq_id}</span> <span className={`tag ${issued ? "pass" : "review"}`}>{issued ? `issued ${draft.issued_on}` : "drafting"}</span></div>
            <button className="secondary" onClick={reset}>New draft</button>
          </div>
          <h2 style={{ margin: "6px 0 8px" }}>{draft.title || <span className="cell-missing">Untitled RFQ</span>}</h2>
          <table><tbody>
            <tr><td style={{ width: 160 }}>Category</td><td>{draft.category || <i className="cell-missing">not set</i>}</td></tr>
            <tr><td>Delivery basis</td><td>{draft.incoterm || <i className="cell-missing">not set</i>}{draft.delivery_location && ` · ${draft.delivery_location}`}</td></tr>
            <tr><td>Max transit time</td><td>{draft.max_transit_days ?? <i className="cell-missing">not set</i>}{draft.max_transit_days != null && " days"}</td></tr>
            <tr><td>Responses due</td><td>{draft.due_on ?? <i className="cell-missing">not set</i>}</td></tr>
            <tr><td>Terms</td><td>{draft.terms.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{draft.terms.map(t => <li key={t.id}>{t.text} {t.status === "approved" ? <span className="tag pass" title={t.approval_note ?? ""}>approved</span> : <><span className="tag review">proposed</span> {!issued && <button className="secondary" style={{ padding: "1px 8px", fontSize: 11, marginLeft: 4 }} onClick={() => edit("approve_terms", { term_ids: [t.id], note: "approved in draft view" })}>Approve</button>}</>}{!issued && <button className="link" title="Remove" onClick={() => edit("remove_terms", { term_ids: [t.id] })}>×</button>}</li>)}</ul> : <i className="cell-missing">none yet</i>}{!issued && draft.terms.some(t => t.status === "proposed") && <button className="secondary" style={{ padding: "2px 10px", fontSize: 12, marginTop: 6 }} onClick={() => edit("approve_terms", { term_ids: ["all"], note: "approved all in draft view" })}>Approve all proposed</button>}</td></tr>
          </tbody></table>
          {draft.open_questions.length > 0 && <div className="callout" style={{ marginBottom: 0 }}><b>Still needed from you:</b><ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{draft.open_questions.map(q => <li key={q.id}>{q.text} <span className="tag muted">{q.about}</span>{!issued && <button className="link" title="Mark resolved" onClick={() => edit("resolve_open_question", { question_id: q.id })}>×</button>}</li>)}</ul></div>}
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>Lanes ({draft.lines.length})</h2>
          {draft.lines.length === 0 ? <div className="empty">No lanes yet.</div> : <div style={{ maxHeight: 340, overflow: "auto" }}><table><thead><tr><th>Lane</th><th>Route</th><th>Unit</th><th className="num">Volume/yr</th><th /></tr></thead><tbody>
            {draft.lines.map(l => <tr key={l.sku}><td className="mono">{l.sku}</td>
              <td><Editable value={l.description} disabled={issued} onSave={v => edit("update_line", { sku: l.sku, description: v })} /></td><td>{l.uom}</td>
              <td className="num"><Editable value={String(l.quantity || "")} placeholder="qty?" disabled={issued} num onSave={v => edit("update_line", { sku: l.sku, quantity: Number(v) })} /></td>
              <td>{!issued && <button className="link" onClick={() => edit("remove_lines", { skus: [l.sku] })} title="Remove">×</button>}</td></tr>)}
          </tbody></table></div>}
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>Quality questionnaire ({draft.quality_questionnaire.length})</h2>
          {draft.quality_questionnaire.length === 0 ? <div className="empty">None yet — ask the co-pilot to propose criteria for this category.</div> : <table><tbody>
            {draft.quality_questionnaire.map(c => <tr key={c.id}><td>{c.label}</td><td style={{ width: 130 }}>
              <label style={{ fontSize: 12, cursor: issued ? "default" : "pointer" }}><input type="checkbox" checked={c.mandatory} disabled={issued} onChange={e => edit("set_questionnaire", { criteria: draft.quality_questionnaire.map(x => x.id === c.id ? { ...x, mandatory: e.target.checked } : x) })} /> mandatory</label></td></tr>)}
          </tbody></table>}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Send to vendors</h2>
          {issued ? <><div className="callout pass">Issued to {draft.sent_to.length} vendors. Emails are in the local outbox (SMTP stubbed).</div>
            <table><tbody>{draft.sent_to.map(s => <tr key={s.vendor_id}><td>{s.name}</td><td className="mono">{s.email}</td><td><a href={`/api/outbox/${draft.rfq_id}/${s.file}`} target="_blank">view email</a></td></tr>)}</tbody></table>
            <p className="sub" style={{ margin: "10px 0 0", fontSize: 12 }}>For the rest of this demo the evaluated RFQ is RFQ-2026-042, whose vendor responses were received earlier; a new RFQ has no responses yet.</p></>
          : <>
            {!ready.ready && <div className="callout">Before sending: {ready.missing.join("; ")}.</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>{vendors.map(v => <label key={v.id} style={{ fontSize: 13 }}><input type="checkbox" checked={sel.includes(v.id)} onChange={e => setSel(s => e.target.checked ? [...s, v.id] : s.filter(x => x !== v.id))} /> {v.name} <span className="mono" style={{ color: "var(--muted)" }}>{v.email}</span></label>)}</div>
            <button onClick={send} disabled={!ready.ready || busy || !sel.length}>Issue {draft.rfq_id} to {sel.length} vendors</button>
          </>}
        </div>
      </>}
    </div>
  </div>);
}
function summ(i: any) { if (!i) return ""; if (i.copy_into_draft != null) return i.copy_into_draft ? "copy_into_draft=true" : "read only"; if (i.term_ids) return i.term_ids.join(","); if (i.lines) return `${i.lines.length} lines`; if (i.criteria) return `${i.criteria.length} criteria`; if (i.terms) return `${i.terms.length} terms`; if (i.questions) return `${i.questions.length}`; return Object.entries(i).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(", "); }
function Editable({ value, onSave, disabled, num, placeholder }: { value: string; onSave: (v: string) => void; disabled?: boolean; num?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value); useEffect(() => setV(value), [value]);
  if (disabled) return <>{value || <i className="cell-missing">{placeholder}</i>}</>;
  return <input className="inline" type={num ? "number" : "text"} value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()} style={num ? { width: 90, textAlign: "right" } : { width: "100%" }} />;
}
