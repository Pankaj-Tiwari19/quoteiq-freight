"use client";
import { useState } from "react";
export default function MemoButton() {
  const [memo, setMemo] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go() { setBusy(true); setErr(""); const r = await fetch("/api/award", { method: "POST" }); const j = await r.json(); setBusy(false); if (!r.ok) setErr(j.error); else setMemo(j.memo); }
  return (<div>
    {memo ? <div style={{ whiteSpace: "pre-wrap", maxWidth: "75ch" }}>{memo}</div> : <p className="sub" style={{ margin: 0 }}>Generate a short written memo from the figures on this page. The model is given only the computed numbers and risks, never asked to invent them.</p>}
    <div style={{ marginTop: 10 }}><button className="secondary" onClick={go} disabled={busy}>{busy ? "Writing…" : memo ? "Regenerate memo" : "Write recommendation memo"}</button>{err && <span style={{ color: "var(--fail)", marginLeft: 8 }}>{err}</span>}</div>
  </div>);
}
