"use client";
import { useEffect, useRef, useState } from "react";
import MiniChart from "./MiniChart";
const SUGGESTIONS = ["Cheapest per lane, all suppliers", "Same, but only suppliers who passed the questionnaire (ISO 9001 and insurance above USD 1M)", "What's the total annual spend under a single-supplier award vs a cheapest-per-lane split? Chart it.", "Which cells are you least sure about?", "What did CorriGlobe (Vendor C) leave out?", "Show me the FX sensitivity if INR moves 5%", "Which quotes are freight-only and why can't they be compared?", "Export the per-lane recommendation as CSV."];
type Artifact = { kind: "chart" | "csv"; payload: any };
type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; input: any; rows: number }[]; artifacts?: Artifact[] };
function csvHref(p: { columns: string[]; rows: any[][] }) { const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`; return "data:text/csv;charset=utf-8," + encodeURIComponent([p.columns.map(esc).join(","), ...p.rows.map(r => r.map(esc).join(","))].join("\n")); }
function Md({ text }: { text: string }) {
  // minimal markdown: pipe tables and **bold**; everything else stays as text
  const blocks = text.split(/\n(?=\|)|\n(?<=\|)\n/); const out: React.ReactNode[] = []; let tbl: string[] = [];
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*)/).map((p, i) => p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p);
  const flush = () => { if (!tbl.length) return; const rows = tbl.map(r => r.split("|").slice(1, -1).map(c => c.trim())).filter(r => !r.every(c => /^:?-+:?$/.test(c))); out.push(<table key={out.length}><thead><tr>{rows[0].map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table>); tbl = []; };
  for (const line of text.split("\n")) { if (/^\s*\|/.test(line)) tbl.push(line); else { flush(); const h = line.match(/^\s*#{1,4}\s+(.*)$/); out.push(h ? <h3 key={out.length}>{inline(h[1])}</h3> : <span key={out.length}>{inline(line)}{"\n"}</span>); } }
  flush(); void blocks; return <>{out}</>;
}
export default function AnalystChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs.map(m => ({ role: m.role, content: m.content }));
    setMsgs(m => [...m, { role: "user", content: text }]); setQ(""); setBusy(true);
    const res = await fetch("/api/analyst", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, history }) });
    const j = await res.json(); setBusy(false);
    setMsgs(m => [...m, { role: "assistant", content: res.ok ? j.answer : `Error: ${j.error}`, tools: j.tool_calls, artifacts: j.artifacts }]);
  }
  return (<div className="chat">
    <div className="log">
      {msgs.length === 0 && <div className="empty">Ask anything about {`RFX-2026-09-FRT`}. Answers are computed by code; the analyst explains them. Try one of the questions below.</div>}
      {msgs.map((m, i) => <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>{m.role === "assistant" ? <Md text={m.content} /> : m.content}
        {m.artifacts?.map((a, k) => a.kind === "chart" ? <MiniChart key={k} {...a.payload} /> : <div key={k} style={{ margin: "8px 0" }}><a className="btn" download={a.payload.filename?.endsWith(".csv") ? a.payload.filename : `${a.payload.filename || "export"}.csv`} href={csvHref(a.payload)}>Download {a.payload.filename || "export.csv"}</a> <small style={{ color: "var(--muted)" }}>{a.payload.rows?.length} rows</small></div>)}
        {m.tools && m.tools.length > 0 && <div className="tools">Computed via: {m.tools.map((t, j) => <code key={j}>{t.name}({["render_chart", "export_table"].includes(t.name) ? "" : Object.entries(t.input ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}) </code>)}</div>}</div>)}
      {busy && <div className="msg ai" style={{ color: "var(--muted)" }}>Querying the dataset…</div>}
      <div ref={end} />
    </div>
    <div>
      <div className="suggest">{SUGGESTIONS.map(s => <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
      <form className="composer" onSubmit={e => { e.preventDefault(); ask(q); }}><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. What did Meridian quote for L07 and what assumptions does the INR number carry?" /><button type="submit" disabled={busy}>Ask</button></form>
    </div>
  </div>);
}
