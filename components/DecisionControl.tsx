"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Target = { kind: "line"; sku: string } | { kind: "questionnaire"; criterion_id: string } | { kind: "basis" };
type Existing = { action: string; reason: string; value?: number | null; interpreted?: string; decided_by: string; decided_at: string } | null;
/** Accept / override / reject a flagged value. Every decision needs a reason; it is stored beside the extraction, never over it. */
export default function DecisionControl({ vendorId, target, existing, originalLabel }: { vendorId: string; target: Target; existing: Existing; originalLabel: string }) {
  const r = useRouter(); const [open, setOpen] = useState(false); const [action, setAction] = useState<"accept" | "override" | "reject">("accept");
  const [value, setValue] = useState(""); const [interp, setInterp] = useState("yes"); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const body: any = { vendor_id: vendorId, target, action, reason, decided_by: "buyer" };
    if (action === "override") { if (target.kind === "line") body.value = Number(value); else body.interpreted = interp; }
    const res = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json(); setBusy(false); if (!res.ok) { setErr(j.error); return; } setOpen(false); r.refresh();
  }
  async function undo() { const id = target.kind === "line" ? `${vendorId}:${target.sku}` : target.kind === "basis" ? `${vendorId}:basis` : `${vendorId}:q:${target.criterion_id}`; await fetch("/api/decisions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); r.refresh(); }
  if (existing && !open) return <div className="decision"><span className={`tag ${existing.action === "accept" || existing.action === "override" ? "pass" : existing.action === "reject" ? "fail" : "muted"}`}>{existing.action}{existing.action === "override" ? ` → ${existing.value ?? existing.interpreted}` : ""}</span> <small>{existing.reason} · {existing.decided_by}, {existing.decided_at.slice(0, 10)}</small> <button className="link" onClick={undo} title="Remove decision">×</button></div>;
  if (!open) return <div className="decision"><button className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setOpen(true)}>Resolve</button></div>;
  return (<div className="decision" style={{ display: "grid", gap: 4, maxWidth: 320 }}>
    <select value={action} onChange={e => setAction(e.target.value as any)}><option value="accept">{target.kind === "basis" ? `Accept ${originalLabel} basis as comparable` : `Accept as read (${originalLabel})`}</option>{target.kind !== "basis" && <option value="override">Override with a value I verified</option>}{target.kind !== "basis" && <option value="reject">Reject (treat as not quoted)</option>}</select>
    {action === "override" && target.kind !== "basis" && (target.kind === "line" ? <input type="number" step="any" placeholder="value in vendor's original unit & currency" value={value} onChange={e => setValue(e.target.value)} /> : <select value={interp} onChange={e => setInterp(e.target.value)}><option value="yes">yes</option><option value="no">no</option><option value="partial">partial</option><option value="unanswered">unanswered</option></select>)}
    <input type="text" placeholder="Reason (required) – e.g. confirmed by phone with R. Shah" value={reason} onChange={e => setReason(e.target.value)} />
    <div style={{ display: "flex", gap: 6 }}><button style={{ padding: "3px 10px", fontSize: 12 }} onClick={save} disabled={busy || !reason.trim()}>Save</button><button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setOpen(false)}>Cancel</button>{err && <span style={{ color: "var(--fail)" }}>{err}</span>}</div>
  </div>);
}
