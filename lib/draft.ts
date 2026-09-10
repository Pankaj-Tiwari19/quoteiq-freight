// RFx co-pilot. The buyer talks; the model edits a draft RFQ only through tools,
// so every field on the screen was either typed by the buyer or set by an explicit,
// visible tool call. Prose from the model never becomes RFQ data.
import fs from "fs";
import path from "path";
import { getLlm, type LlmTool } from "./llm";
import type { QualityCriterion, RfqLine, Vendor } from "./types";
import { loadVendors, loadRfq } from "./normalize";

/** A commercial term. Proposed by the co-pilot until the buyer explicitly approves it (via approve_terms, from chat or the UI). */
export interface DraftTerm { id: string; text: string; status: "proposed" | "approved"; proposed_by: "copilot" | "buyer"; approved_at: string | null; approval_note: string | null }
/** Something still needed from the buyer. `about` ties it to the part of the draft it blocks, so an explicit edit to that part resolves it deterministically. */
export interface OpenQuestion { id: string; text: string; about: "terms" | "lines" | "header" | "questionnaire" | "other" }
export interface DraftRfq {
  rfq_id: string; title: string; category: string; buyer: string; currency: "INR";
  incoterm: string; delivery_location: string; max_transit_days: number | null; due_on: string | null;
  terms: DraftTerm[];                    // payment, validity, GST, packing etc.
  quality_questionnaire: QualityCriterion[];
  lines: RfqLine[];
  status: "drafting" | "issued";
  issued_on: string | null;
  sent_to: { vendor_id: string; name: string; email: string; file: string }[];
  open_questions: OpenQuestion[];
  revision: number;                      // bumped on every persisted change
  updated_at: string;
}

const DRAFT_DIR = path.join(process.cwd(), "data", "draft");
const DRAFT_FILE = path.join(DRAFT_DIR, "rfq_draft.json");
export const OUTBOX_DIR = path.join(process.cwd(), "data", "outbox");

export function emptyDraft(): DraftRfq {
  const n = new Date();
  return { rfq_id: `RFQ-${n.getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`, title: "", category: "", buyer: "Aerchain Procurement", currency: "INR",
    incoterm: "", delivery_location: "", max_transit_days: null, due_on: null, terms: [], quality_questionnaire: [], lines: [],
    status: "drafting", issued_on: null, sent_to: [], open_questions: [], revision: 0, updated_at: n.toISOString() };
}
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const stripProposed = (t: string) => t.replace(/\s*\((proposed|proposal)\)\s*:?\s*/i, " ").replace(/^\s*(proposed|proposal)\s*:\s*/i, "").trim();
/** Accept drafts written by the previous shape (plain strings) so an in-progress draft survives the upgrade. */
function upgradeDraft(d: any): DraftRfq {
  d.terms = (d.terms ?? []).map((t: any) => typeof t === "string" ? { id: newId("term"), text: stripProposed(t), status: "proposed", proposed_by: "copilot", approved_at: null, approval_note: null } : t);
  d.open_questions = (d.open_questions ?? []).map((q: any) => typeof q === "string" ? { id: newId("q"), text: q, about: /term|payment|validity|penalt/i.test(q) ? "terms" : /quantit|line/i.test(q) ? "lines" : /date|lead|deliver|incoterm|location/i.test(q) ? "header" : /questionnaire|criteri/i.test(q) ? "questionnaire" : "other" } : q);
  d.revision ??= 0;
  return d;
}
export function loadDraft(): DraftRfq { try { return upgradeDraft(JSON.parse(fs.readFileSync(DRAFT_FILE, "utf8"))); } catch { return emptyDraft(); } }
export function saveDraft(d: DraftRfq) { fs.mkdirSync(DRAFT_DIR, { recursive: true }); d.revision = (d.revision ?? 0) + 1; d.updated_at = new Date().toISOString(); const tmp = DRAFT_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, DRAFT_FILE); return d; }
export function resetDraft() { return saveDraft(emptyDraft()); }
/** Atomic read-modify-write: every tool call reloads the latest draft from disk, applies one change, and persists it.
 *  This is what makes the co-pilot loop and the buyer's inline edits safe to interleave – no in-memory copy is ever saved over a newer one. */
export function mutateDraft<T>(fn: (d: DraftRfq) => T): { result: T; draft: DraftRfq } { const d = loadDraft(); const result = fn(d); return { result, draft: saveDraft(d) }; }

// ---------- tools the co-pilot may call ----------
const TOOLS: LlmTool[] = [
  { name: "set_header", description: "Set top-level RFQ fields. Only pass fields the buyer has stated or agreed to.", input_schema: { type: "object", properties: {
    title: { type: "string" }, category: { type: "string" }, incoterm: { type: "string", description: "e.g. 'Delivered to buyer DC' or 'Ex-works'" }, delivery_location: { type: "string" },
    max_transit_days: { type: "number" }, due_on: { type: "string", description: "ISO date for vendor responses" } } } },
  { name: "add_lines", description: "Append lanes. Lane ids (L01…) are assigned automatically if omitted. Annual volumes must come from the buyer; if unknown, leave quantity 0 and add an open question. Unit is the basis every quote will be normalised to: 20GP or 40HC for FCL, CBM for LCL (with a declared cargo density), KG for air.", input_schema: { type: "object", required: ["lines"], properties: {
    lines: { type: "array", items: { type: "object", required: ["description", "quantity", "uom"], properties: { sku: { type: "string" }, description: { type: "string", description: "Origin → destination, e.g. 'Nhava Sheva → Rotterdam'" }, quantity: { type: "number" }, uom: { type: "string", enum: ["20GP", "40HC", "CBM", "KG"] }, mode: { type: "string", enum: ["FCL", "LCL", "AIR"] }, cargo_density_kg_per_cbm: { type: "number", description: "LCL only" } } } } } } },
  { name: "update_line", description: "Change the description or quantity of one existing line.", input_schema: { type: "object", required: ["sku"], properties: { sku: { type: "string" }, description: { type: "string" }, quantity: { type: "number" } } } },
  { name: "remove_lines", description: "Remove lines by SKU.", input_schema: { type: "object", required: ["skus"], properties: { skus: { type: "array", items: { type: "string" } } } } },
  { name: "set_questionnaire", description: "Replace the quality questionnaire. Mark a criterion mandatory only if the buyer said failing it should exclude the vendor.", input_schema: { type: "object", required: ["criteria"], properties: {
    criteria: { type: "array", items: { type: "object", required: ["id", "label", "mandatory"], properties: { id: { type: "string", description: "snake_case id" }, label: { type: "string" }, mandatory: { type: "boolean" } } } } } } },
  { name: "propose_terms", description: "Add commercial terms (payment, validity, GST basis, packing, penalties) as PROPOSALS. They stay 'proposed' until the buyer explicitly approves them. Do not include the word 'proposed' in the text; the status is tracked separately.", input_schema: { type: "object", required: ["terms"], properties: { terms: { type: "array", items: { type: "string" } }, replace: { type: "boolean", description: "true to replace all existing proposed (not approved) terms; default appends" } } } },
  { name: "approve_terms", description: "Mark terms as approved. Call ONLY when the buyer has explicitly approved them in their message. Pass term ids from the draft, or 'all' for every proposed term. Approving terms automatically resolves open questions about terms.", input_schema: { type: "object", required: ["term_ids"], properties: { term_ids: { type: "array", items: { type: "string" }, description: "term ids, or ['all']" }, note: { type: "string", description: "Short quote of the buyer's approval" } } } },
  { name: "remove_terms", description: "Remove terms by id (buyer rejected or changed their mind).", input_schema: { type: "object", required: ["term_ids"], properties: { term_ids: { type: "array", items: { type: "string" } } } } },
  { name: "add_open_question", description: "Record something you still need the buyer to decide. Set 'about' to the part of the draft it blocks.", input_schema: { type: "object", required: ["text", "about"], properties: { text: { type: "string" }, about: { type: "string", enum: ["terms", "lines", "header", "questionnaire", "other"] } } } },
  { name: "resolve_open_question", description: "Remove an open question once the buyer has answered it. Pass the question id.", input_schema: { type: "object", required: ["question_id"], properties: { question_id: { type: "string" } } } },
  { name: "get_draft", description: "Read the current draft.", input_schema: { type: "object", properties: {} } },
  { name: "load_evaluated_rfq", description: "Read the existing, already-issued RFQ (RFX-2026-09-FRT, the freight lanes whose supplier responses are being evaluated) from its source file at runtime and return its header, questionnaire and all line items (lane id, route, annual volume, unit, mode, density). Use when the buyer asks to load, reuse, copy or start from the evaluated/existing/previous RFQ. With copy_into_draft=true the lines, questionnaire and header are copied verbatim from the source into the draft (nothing is retyped by you); without it the data is only returned for you to read.", input_schema: { type: "object", properties: { copy_into_draft: { type: "boolean", description: "true to copy the source RFQ into the current draft verbatim; default false" } } } },
];

/** Reads data/rfq.json at call time. Specifications are the part of the description after the style+dimensions (split on the first comma), taken from the source text as-is. */
export function loadEvaluatedRfq() {
  const r = loadRfq();
  return { rfq_id: r.rfq_id, title: r.title, category: r.category, incoterm: r.incoterm, max_transit_days: r.max_transit_days, due_on: r.due_on, status: r.status, currency: r.currency,
    quality_questionnaire: r.quality_questionnaire, line_count: r.lines.length,
    lines: r.lines.map(l => ({ sku: l.sku, description: l.description, quantity: l.quantity, unit: l.uom, mode: l.mode, density: l.cargo_density_kg_per_cbm ?? null })) };
}

function nextSku(d: DraftRfq, prefix: string) {
  const nums = d.lines.map(l => parseInt(l.sku.replace(/^\D+/, ""), 10)).filter(n => !isNaN(n));
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0")}`;
}
function skuPrefix(d: DraftRfq) {
  const c = d.category.toLowerCase();
  void c; return "L";
}

export function applyDraftTool(d: DraftRfq, name: string, input: any): any {
  switch (name) {
    case "set_header": { for (const k of ["title", "category", "incoterm", "delivery_location", "max_transit_days", "due_on"] as const) if (input[k] != null) (d as any)[k] = input[k]; return { ok: true, header: { title: d.title, category: d.category, incoterm: d.incoterm, delivery_location: d.delivery_location, max_transit_days: d.max_transit_days, due_on: d.due_on } }; }
    case "add_lines": { const added: string[] = []; for (const l of input.lines ?? []) { const sku = (l.sku && !d.lines.some(x => x.sku === l.sku)) ? String(l.sku).toUpperCase() : nextSku(d, skuPrefix(d)); const uom = (["20GP", "40HC", "CBM", "KG"].includes(l.uom) ? l.uom : "40HC") as RfqLine["uom"]; const mode = (l.mode ?? (uom === "CBM" ? "LCL" : uom === "KG" ? "AIR" : "FCL")) as RfqLine["mode"]; const [o, dd] = String(l.description ?? "").split(/\s*(?:→|->|–|-)\s*/); d.lines.push({ sku, description: String(l.description ?? ""), quantity: Number(l.quantity) || 0, uom, mode, origin: "", origin_name: o ?? "", destination: "", destination_name: dd ?? "", direction: "export", ...(l.cargo_density_kg_per_cbm ? { cargo_density_kg_per_cbm: Number(l.cargo_density_kg_per_cbm) } : {}) }); added.push(sku); } return { ok: true, added, total_lines: d.lines.length }; }
    case "update_line": { const l = d.lines.find(x => x.sku === String(input.sku).toUpperCase()); if (!l) return { error: `No line ${input.sku}` }; if (input.description != null) l.description = input.description; if (input.quantity != null) l.quantity = Number(input.quantity); return { ok: true, line: l }; }
    case "remove_lines": { const set = new Set((input.skus ?? []).map((s: string) => s.toUpperCase())); const before = d.lines.length; d.lines = d.lines.filter(l => !set.has(l.sku)); return { ok: true, removed: before - d.lines.length }; }
    case "set_questionnaire": { d.quality_questionnaire = (input.criteria ?? []).map((c: any) => ({ id: String(c.id).toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: String(c.label), mandatory: !!c.mandatory })); return { ok: true, count: d.quality_questionnaire.length, mandatory: d.quality_questionnaire.filter(c => c.mandatory).map(c => c.label) }; }
    case "set_terms":  // legacy alias: behaves as propose_terms with replace
    case "propose_terms": {
      if (input.replace || name === "set_terms") d.terms = d.terms.filter(t => t.status === "approved");
      const added: DraftTerm[] = (input.terms ?? []).map((t: any): DraftTerm => ({ id: newId("term"), text: stripProposed(String(t)), status: "proposed", proposed_by: "copilot", approved_at: null, approval_note: null })).filter((t: DraftTerm) => t.text);
      d.terms.push(...added);
      return { ok: true, proposed: added.map(t => ({ id: t.id, text: t.text })), awaiting_buyer_approval: d.terms.filter(t => t.status === "proposed").length };
    }
    case "approve_terms": {
      const ids: string[] = (input.term_ids ?? []).map(String); const all = ids.includes("all");
      const hit = d.terms.filter(t => t.status === "proposed" && (all || ids.includes(t.id)));
      if (!hit.length) return { error: "No matching proposed terms. Current term ids: " + d.terms.map(t => `${t.id} (${t.status})`).join(", ") };
      const now = new Date().toISOString();
      for (const t of hit) { t.status = "approved"; t.approved_at = now; t.approval_note = input.note ? String(input.note) : "approved by buyer"; }
      // explicit approval of terms deterministically resolves open questions that were about terms
      const resolved = d.open_questions.filter(q => q.about === "terms"); d.open_questions = d.open_questions.filter(q => q.about !== "terms");
      return { ok: true, approved: hit.map(t => t.id), resolved_open_questions: resolved.map(q => q.text), still_proposed: d.terms.filter(t => t.status === "proposed").length };
    }
    case "remove_terms": { const set = new Set((input.term_ids ?? []).map(String)); const before = d.terms.length; d.terms = d.terms.filter(t => !set.has(t.id)); return { ok: true, removed: before - d.terms.length }; }
    case "add_open_question": { const q: OpenQuestion = { id: newId("q"), text: String(input.text), about: input.about ?? "other" }; d.open_questions.push(q); return { ok: true, question: q }; }
    case "resolve_open_question": { const before = d.open_questions.length; d.open_questions = d.open_questions.filter(q => q.id !== String(input.question_id)); return before === d.open_questions.length ? { error: `No open question ${input.question_id}. Ids: ${d.open_questions.map(q => q.id).join(", ")}` } : { ok: true }; }
    case "set_open_questions": {  // legacy alias: replace-all with untyped questions
      d.open_questions = (input.questions ?? []).map((t: any) => ({ id: newId("q"), text: String(t), about: "other" as const })); return { ok: true };
    }
    case "get_draft": return d;
    case "load_evaluated_rfq": {
      const src = loadEvaluatedRfq();
      if (input?.copy_into_draft) {
        const r = loadRfq();
        d.title = r.title; d.category = r.category; d.incoterm = r.incoterm; d.max_transit_days = r.max_transit_days;
        d.quality_questionnaire = r.quality_questionnaire.map(c => ({ ...c }));
        d.lines = r.lines.map(l => ({ ...l }));  // verbatim from source
        d.open_questions = d.open_questions.filter(q => q.about !== "lines" && q.about !== "questionnaire");
        return { ok: true, copied_from: src.rfq_id, lines: d.lines.length, questionnaire: d.quality_questionnaire.length, note: "Copied verbatim from data/rfq.json into the draft. Due date was not copied (it belongs to the old RFQ)." };
      }
      return src;
    }
    default: return { error: "unknown tool" };
  }
}

export function draftReadiness(d: DraftRfq) {
  const missing: string[] = [];
  if (!d.title) missing.push("title"); if (!d.category) missing.push("category"); if (!d.lines.length) missing.push("at least one line item");
  if (d.lines.some(l => !l.quantity)) missing.push(`quantities for ${d.lines.filter(l => !l.quantity).map(l => l.sku).join(", ")}`);
  if (!d.max_transit_days) missing.push("maximum transit time"); if (!d.due_on) missing.push("response due date"); if (!d.incoterm) missing.push("delivery basis / incoterm");
  if (!d.quality_questionnaire.length) missing.push("quality questionnaire");
  const proposed = d.terms.filter(t => t.status === "proposed"); if (proposed.length) missing.push(`approval of ${proposed.length} proposed term${proposed.length > 1 ? "s" : ""}`);
  if (d.open_questions.length) missing.push(`${d.open_questions.length} open question${d.open_questions.length > 1 ? "s" : ""}`);
  return { ready: missing.length === 0 && d.status === "drafting", missing };
}

const SYSTEM = `You are QuoteIQ's RFx co-pilot. You help a procurement buyer draft an RFQ by conversation, and you record the draft ONLY through tools. Rules:
- Never put RFQ content only in prose: if the buyer states or agrees to something, call the matching tool so it lands in the draft.
- Never invent quantities, dates or delivery locations. If the buyer hasn't given them, ask, and record what is still needed with add_open_question (set 'about' to the part it blocks).
- Terms: add them with propose_terms; they stay proposed until the buyer approves. When the buyer explicitly approves (e.g. "yes, approve the payment terms"), you MUST call approve_terms with the ids (or ['all']) – saying "approved" in prose changes nothing. Never re-propose terms the buyer just approved. When the buyer answers an open question, call resolve_open_question (or the edit that answers it).
- You MAY propose line-item descriptions, questionnaire criteria and terms that are standard for the category (e.g. for freight lanes: ISO 9001, IATA/FIATA membership, own vs third-party CFS, claims ratio, marine liability cover, escalation SLA, ESG reporting, references). Propose them, add them, and say clearly they are proposals the buyer can change.
- Lanes need origin, destination, mode and the unit quotes will be normalised to (20GP/40HC, CBM with declared density, or KG). If the buyer says "LCL" without a density, ask for it – "per w/m" quotes cannot be compared without one.
- Mark a criterion mandatory only when the buyer says failing it should exclude a vendor; otherwise non-mandatory.
- If the buyer asks to load, reuse or start from the existing/evaluated/previous RFQ (RFX-2026-09-FRT), call load_evaluated_rfq. To bring its lines into the draft use copy_into_draft=true so the values are copied from the source file rather than retyped by you. Never reproduce those line items from memory.
- Be brief. After each turn, summarise what changed in one or two lines and ask the single most useful next question.`;

export async function copilotTurn(history: { role: "user" | "assistant"; content: string }[], question: string) {
  const d0 = loadDraft();
  if (d0.status === "issued") return { answer: `${d0.rfq_id} has already been issued. Start a new draft to make changes.`, tool_calls: [], draft: d0 };
  const llm = await getLlm();
  const context = `Current draft: ${JSON.stringify({ ...d0, lines: d0.lines.length > 40 ? `${d0.lines.length} lines (use get_draft to see them)` : d0.lines })}`;
  // Each tool call is its own read-modify-write against disk, so the loop never saves a stale in-memory copy over an edit the buyer made meanwhile.
  const r = await llm.chatWithTools({ system: `${SYSTEM}\n\n${context}`, history, question, tools: TOOLS, runTool: (name, input) => name === "get_draft" || (name === "load_evaluated_rfq" && !input?.copy_into_draft) ? applyDraftTool(loadDraft(), name, input) : mutateDraft(d => applyDraftTool(d, name, input)).result, maxIterations: 8, maxTokens: 3000 });
  return { ...r, draft: loadDraft() };
}

// ---------- stubbed channel: writes .eml files to data/outbox instead of sending ----------
export function renderRfqEmail(d: DraftRfq, v: Vendor) {
  const lines = d.lines.map(l => `${l.sku}\t${l.description}\t${l.quantity.toLocaleString("en-IN")} ${l.uom}`).join("\n");
  const q = d.quality_questionnaire.map(c => `- ${c.label}${c.mandatory ? " (mandatory – a 'No' excludes your offer)" : ""}`).join("\n");
  return [`From: procurement@aerchain.example`, `To: ${v.email ?? `sales@${v.id}.example`}`, `Subject: ${d.rfq_id} – Request for quotation – ${d.title}`, `Date: ${new Date().toUTCString()}`, ``,
    `Dear ${v.name},`, ``, `Please quote for the following. Delivery basis: ${d.incoterm}${d.delivery_location ? ` (${d.delivery_location})` : ""}. Maximum transit time: ${d.max_transit_days} days. Responses due ${d.due_on}. Currency for evaluation: INR; if you quote in another currency, state it clearly.`, ``,
    `LANES`, `Lane\tRoute\tAnnual volume (unit)`, lines, ``, `QUALITY QUESTIONNAIRE (answer each)`, q, ``, `TERMS`, ...d.terms.filter(t => t.status === "approved").map(t => `- ${t.text}`), ``,
    `You may reply in any format (spreadsheet, PDF, letter, email, photo of your rate card). Please quote per lane in the unit shown, all-in port to port where possible, and state clearly what is excluded (THC, documentation, BAF/CAF). State transit time and destination free days per lane.`, ``, `Regards,`, `Aerchain Procurement`].join("\n");
}

export function sendDraft(vendorIds?: string[]) {
  const d = loadDraft(); const ready = draftReadiness(d);
  if (!ready.ready) throw new Error(`Draft not ready: ${ready.missing.join("; ")}`);
  const vendors = loadVendors().filter(v => !vendorIds || vendorIds.includes(v.id));
  if (!vendors.length) throw new Error("No vendors selected");
  const dir = path.join(OUTBOX_DIR, d.rfq_id); fs.mkdirSync(dir, { recursive: true });
  d.sent_to = vendors.map(v => { const file = `${v.id}.eml`; fs.writeFileSync(path.join(dir, file), renderRfqEmail(d, v)); return { vendor_id: v.id, name: v.name, email: v.email ?? `sales@${v.id}.example`, file }; });
  d.status = "issued"; d.issued_on = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.join(process.cwd(), "data", "rfqs"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "data", "rfqs", `${d.rfq_id}.json`), JSON.stringify(d, null, 2));
  return saveDraft(d);
}
export function readOutbox(rfqId: string, file: string) { const p = path.join(OUTBOX_DIR, path.basename(rfqId), path.basename(file)); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; }
