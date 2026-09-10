import { NextResponse } from "next/server";
import { llmUnavailableReason } from "@/lib/llm";
import { loadRfq, loadVendors } from "@/lib/normalize";
import { extractVendor } from "@/lib/extract";
export const maxDuration = 300;
export async function POST(req: Request) {
  const why = llmUnavailableReason(); if (why) return NextResponse.json({ error: why }, { status: 400 });
  const { vendor_id } = await req.json();
  const rfq = loadRfq(); const vendors = loadVendors().filter(v => vendor_id === "all" || v.id === vendor_id);
  if (!vendors.length) return NextResponse.json({ error: "Unknown vendor" }, { status: 404 });
  try {
    const out = [];
    for (const v of vendors) { const ex = await extractVendor(rfq, v); out.push({ vendor_id: v.id, lines: ex.lines.length }); }
    return NextResponse.json({ ok: true, extracted: out });
  } catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
