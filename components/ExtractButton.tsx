"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function ExtractButton({ vendorId, label }: { vendorId: string; label: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const r = useRouter();
  async function go() {
    setBusy(true); setErr("");
    const res = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor_id: vendorId }) });
    const j = await res.json(); setBusy(false);
    if (!res.ok) setErr(j.error || "Extraction failed"); else r.refresh();
  }
  return <span><button className="secondary" onClick={go} disabled={busy}>{busy ? "Extracting…" : label}</button>{err && <span style={{ color: "var(--fail)", marginLeft: 8 }}>{err}</span>}</span>;
}
