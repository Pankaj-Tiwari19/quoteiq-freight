import { NextResponse } from "next/server";
import { llmUnavailableReason } from "@/lib/llm";
import { buildDataset } from "@/lib/normalize";
import { narrateRecommendation } from "@/lib/analyst";
export const maxDuration = 120;
export async function POST() {
  const why = llmUnavailableReason(); if (why) return NextResponse.json({ error: why }, { status: 400 });
  try { const r = await narrateRecommendation(buildDataset()); return NextResponse.json({ memo: r.memo }); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
