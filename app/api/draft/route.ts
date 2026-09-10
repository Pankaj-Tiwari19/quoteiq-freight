import { NextResponse } from "next/server";
import { llmUnavailableReason } from "@/lib/llm";
import { copilotTurn, loadDraft, resetDraft, applyDraftTool, draftReadiness, mutateDraft } from "@/lib/draft";
export const maxDuration = 120;
export async function GET() { const d = loadDraft(); return NextResponse.json({ draft: d, readiness: draftReadiness(d) }); }
// Co-pilot turn
export async function POST(req: Request) {
  const why = llmUnavailableReason(); if (why) return NextResponse.json({ error: why }, { status: 400 });
  const { question, history = [] } = await req.json();
  try { const r = await copilotTurn(history.slice(-12), question); return NextResponse.json({ ...r, readiness: draftReadiness(r.draft) }); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 }); }
}
// Manual edits from the buyer (same tools the model uses, so the audit trail is identical) or reset
export async function PUT(req: Request) {
  const { tool, input, reset } = await req.json();
  if (reset) { const d = resetDraft(); return NextResponse.json({ draft: d, readiness: draftReadiness(d) }); }
  if (loadDraft().status === "issued") return NextResponse.json({ error: "RFQ already issued" }, { status: 400 });
  const { result, draft } = mutateDraft(d => applyDraftTool(d, tool, input));
  if (result && typeof result === "object" && "error" in result) return NextResponse.json({ error: (result as any).error, draft, readiness: draftReadiness(draft) }, { status: 400 });
  return NextResponse.json({ result, draft, readiness: draftReadiness(draft) });
}
