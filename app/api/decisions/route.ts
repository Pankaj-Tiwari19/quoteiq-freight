import { NextResponse } from "next/server";
import { loadDecisions, recordDecision, removeDecision } from "@/lib/decisions";
export async function GET() { return NextResponse.json({ decisions: loadDecisions() }); }
export async function POST(req: Request) {
  try { const d = recordDecision(await req.json()); return NextResponse.json({ decision: d }); }
  catch (e: any) { return NextResponse.json({ error: e.message ?? String(e) }, { status: 400 }); }
}
export async function DELETE(req: Request) { const { id } = await req.json(); removeDecision(id); return NextResponse.json({ ok: true }); }
