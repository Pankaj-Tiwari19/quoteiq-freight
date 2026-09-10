import { NextResponse } from "next/server";
import { llmUnavailableReason } from "@/lib/llm";
import { draftClarification } from "@/lib/clarify";
export const maxDuration = 120;
export async function POST(req: Request) {
  const why = llmUnavailableReason(); if (why) return NextResponse.json({ error: why }, { status: 400 });
  const { vendor_id } = await req.json();
  try { return NextResponse.json(await draftClarification(vendor_id)); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 400 }); }
}
