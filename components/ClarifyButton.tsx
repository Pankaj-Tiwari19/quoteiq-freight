"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function ClarifyButton({ vendorId, count }: { vendorId: string; count: number }) {
  const r = useRouter(); const [busy, setBusy] = useState(false); const [out, setOut] = useState<{ file: string; rfq_id: string; body: string } | null>(null); const [err, setErr] = useState("");
  async function go() { setBusy(true); setErr(""); const res = await fetch("/api/clarify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_id: vendorId }) }); const j = await res.json(); setBusy(false); if (!res.ok) setErr(j.error); else { setOut(j); r.refresh(); } }
  return (<div>
    <button className="secondary" onClick={go} disabled={busy || count === 0}>{busy ? "Drafting…" : `Draft clarification email (${count} open items)`}</button>{err && <span style={{ color: "var(--fail)", marginLeft: 8 }}>{err}</span>}
    {out && <div className="callout pass" style={{ marginBottom: 0 }}>Written to outbox: <a href={`/api/outbox/${out.rfq_id}/${out.file}`} target="_blank">{out.file}</a> (SMTP stubbed). Items are now marked “clarify” below.<details style={{ marginTop: 6 }}><summary style={{ cursor: "pointer" }}>Preview</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{out.body}</pre></details></div>}
  </div>);
}
