import fs from "fs"; import path from "path";
import { DOCS_DIR } from "@/lib/parse";
const types: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".eml": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params; const safe = path.basename(file); const p = path.join(DOCS_DIR, safe);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "content-type": types[path.extname(safe)] ?? "application/octet-stream", "content-disposition": `inline; filename="${safe}"` } });
}
