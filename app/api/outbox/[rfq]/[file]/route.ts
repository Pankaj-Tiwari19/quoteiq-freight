import { readOutbox } from "@/lib/draft";
export async function GET(_: Request, { params }: { params: Promise<{ rfq: string; file: string }> }) {
  const { rfq, file } = await params; const t = readOutbox(rfq, file);
  return t == null ? new Response("Not found", { status: 404 }) : new Response(t, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
