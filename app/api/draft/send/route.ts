import { NextResponse } from "next/server";
import { sendDraft, draftReadiness } from "@/lib/draft";
export async function POST(req: Request) {
  const { vendor_ids } = await req.json().catch(() => ({}));
  try { const d = sendDraft(vendor_ids); return NextResponse.json({ draft: d, readiness: draftReadiness(d) }); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 400 }); }
}
