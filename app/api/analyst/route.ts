import { NextResponse } from "next/server";
import { llmUnavailableReason } from "@/lib/llm";
import { buildDataset } from "@/lib/normalize";
import { askAnalyst } from "@/lib/analyst";
export const maxDuration = 120;
export async function POST(req: Request) {
  const why = llmUnavailableReason(); if (why) return NextResponse.json({ error: why }, { status: 400 });
  const { question, history = [] } = await req.json();
  const ds = buildDataset();
  if (!ds.summaries.some(s => s.extracted)) return NextResponse.json({ error: "No vendor responses have been extracted yet." }, { status: 400 });
  try { return NextResponse.json(await askAnalyst(ds, history.slice(-10), question)); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
