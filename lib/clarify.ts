// Clarification emails: generated from the review list, written to the outbox (SMTP stubbed),
// and every item included is recorded as a "clarify" decision so the audit trail shows it was raised.
import fs from "fs";
import path from "path";
import { getLlm } from "./llm";
import { buildDataset } from "./normalize";
import { recordDecision } from "./decisions";
import { OUTBOX_DIR } from "./draft";

export async function draftClarification(vendorId: string, decidedBy = "buyer") {
  const ds = buildDataset(); const v = ds.vendors.find(x => x.id === vendorId); if (!v) throw new Error("Unknown vendor");
  const s = ds.summaries.find(x => x.vendor_id === vendorId)!;
  const items = ds.normalized.filter(n => n.vendor_id === vendorId && n.review_required && !n.review_reasons.includes("missing_quote") && !(n.decision && n.decision.action !== "clarify"));
  const missing = s.lines_missing; const qs = s.quality.answers.filter(a => a.interpreted === "unanswered" || a.interpreted === "partial" || a.review_required);
  if (!items.length && !missing.length && !qs.length) throw new Error("Nothing to clarify for this vendor.");
  const llm = await getLlm();
  const facts = { rfq: ds.rfq.rfq_id, vendor: v.name, lanes: items.map(n => ({ lane: n.sku, route: ds.rfq.lines.find(l => l.sku === n.sku)?.description, what_we_read: n.raw_text, as_value: n.original_value, unit: n.original_unit, currency: n.original_currency, problem: n.review_note, where: n.source_location })),
    not_quoted: missing.map(sku => ({ lane: sku, route: ds.rfq.lines.find(l => l.sku === sku)?.description, unit: ds.rfq.lines.find(l => l.sku === sku)?.uom })), questionnaire: qs.map(a => ({ criterion: a.label, mandatory: a.mandatory, what_we_read: a.answer_text || "(not addressed)" })),
    basis: s.basis === "freight_only" || s.basis === "partial" ? `Quoted ${s.basis.replace("_", " ")}; please provide the surcharge schedule (THC, documentation) so rates can be compared all-in` : null };
  const body = await llm.complete({ maxTokens: 1200, system: "You write short, courteous clarification emails from a procurement buyer to a supplier. Use only the facts given. One numbered question per item, quoting exactly what was read so the supplier can confirm or correct it. Ask for a reply by a date placeholder [DATE]. No pricing advice, no invented numbers. Plain text, no markdown.",
    prompt: `Write the email body (no subject line) for:\n${JSON.stringify(facts, null, 1)}` });
  const eml = [`From: procurement@aerchain.example`, `To: ${v.email ?? `sales@${v.id}.example`}`, `Subject: ${ds.rfq.rfq_id} – clarifications on your freight rates`, `Date: ${new Date().toUTCString()}`, ``, body].join("\n");
  const dir = path.join(OUTBOX_DIR, ds.rfq.rfq_id); fs.mkdirSync(dir, { recursive: true });
  const file = `clarify_${v.id}_${Date.now()}.eml`; fs.writeFileSync(path.join(dir, file), eml);
  for (const n of items) recordDecision({ vendor_id: v.id, target: { kind: "line", sku: n.sku }, action: "clarify", reason: `Clarification sent (${file})`, decided_by: decidedBy });
  for (const a of qs) recordDecision({ vendor_id: v.id, target: { kind: "questionnaire", criterion_id: a.criterion_id }, action: "clarify", reason: `Clarification sent (${file})`, decided_by: decidedBy });
  return { file, rfq_id: ds.rfq.rfq_id, body, items: items.length + missing.length + qs.length };
}
