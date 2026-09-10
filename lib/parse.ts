import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { Vendor } from "./types";

export const DOCS_DIR = path.join(process.cwd(), "data", "vendor_docs");

export type ParsedDoc =
  | { kind: "text"; text: string; note: string }
  | { kind: "image"; base64: string; media_type: "image/jpeg" | "image/png" | "application/pdf"; note: string };

/** Convert a vendor response file into something the LLM extractor can read.
 *  We keep location hints (row numbers, page markers, line numbers) so the extractor can cite provenance. */
async function pdfText(file: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    // group text items by y coordinate so table rows survive extraction
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as any[]) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map(c => c.s).join("  "));
    pages.push(`=== Page ${p} ===\n` + lines.map((l, i) => `p${p}.l${i + 1}: ${l}`).join("\n"));
  }
  return pages.join("\n");
}

/** Text of every attachment (certificates, test reports) so the extractor can read questionnaire evidence. */
export async function attachmentsText(v: Vendor): Promise<string> {
  const parts: string[] = [];
  for (const a of v.attachments ?? []) {
    const f = path.join(DOCS_DIR, a); if (!fs.existsSync(f)) continue;
    const ext = path.extname(a).toLowerCase();
    const text = ext === ".pdf" ? await pdfText(f) : ext === ".txt" ? fs.readFileSync(f, "utf8") : `(binary attachment ${a}, not read)`;
    parts.push(`=== Attachment: ${a} ===\n${text}`);
  }
  return parts.join("\n\n");
}

/** Text rendering of any document, for display. PDFs use pdfjs with page/line markers. */
export async function documentText(v: Vendor): Promise<string> {
  const file = path.join(DOCS_DIR, v.file);
  if (v.response_format === "pdf") return await pdfText(file);
  const d = await parseMain(v, file);
  return d.kind === "text" ? d.text : "(image)";
}

export async function parseVendorDoc(v: Vendor): Promise<ParsedDoc> {
  const file = path.join(DOCS_DIR, v.file);
  const d = await parseMain(v, file);
  const att = await attachmentsText(v);
  if (!att) return d;
  if (d.kind === "text") return { ...d, text: `${d.text}\n\n${att}`, note: `${d.note} Attachment text appended.` };
  return { ...d, note: `${d.note} Attachment text: ${att.slice(0, 2000)}` };
}

async function parseMain(v: Vendor, file: string): Promise<ParsedDoc> {
  switch (v.response_format) {
    case "xlsx": {
      const wb = XLSX.readFile(file);
      const out: string[] = [];
      for (const name of wb.SheetNames) {
        const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true });
        out.push(`=== Sheet "${name}" ===`);
        rows.forEach((r, i) => { if (r.length) out.push(`row ${i + 1}: ${r.map(c => c ?? "").join(" | ")}`); });
      }
      return { kind: "text", text: out.join("\n"), note: "Excel workbook flattened as 'row N: cell | cell'." };
    }
    case "pdf": {
      // The PDF goes to the model as the document itself (this is the path validated on Vendor B: page-2 footnotes
      // arrive as conditions, never applied). The text rendering is kept for the vendor page's "what the vendor sent" panel.
      const b64 = fs.readFileSync(file).toString("base64");
      return { kind: "image", base64: b64, media_type: "application/pdf", note: "PDF sent inline as a document. Cite page numbers in evidence.page." };
    }
    case "docx": {
      const { value } = await mammoth.extractRawText({ path: file });
      const lines = value.split(/\n+/).filter(Boolean).map((l, i) => `para ${i + 1}: ${l}`);
      return { kind: "text", text: lines.join("\n"), note: "Word document paragraphs." };
    }
    case "email": {
      const text = fs.readFileSync(file, "utf8").split("\n").map((l, i) => `line ${i + 1}: ${l}`).join("\n");
      return { kind: "text", text, note: "Raw email (.eml) with line numbers." };
    }
    case "image": {
      const b64 = fs.readFileSync(file).toString("base64");
      return { kind: "image", base64: b64, media_type: path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg", note: "Photograph of a printed rate card; read visually. Smudged or unreadable digits must come back as null with a low confidence, never guessed." };
    }
  }
}
