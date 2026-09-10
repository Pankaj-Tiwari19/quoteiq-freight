import fs from "fs";
import path from "path";
import { parseVendorDoc } from "./parse";
import type { Extraction, Rfq, Vendor } from "./types";
import { getLlm, type LlmContent } from "./llm";

export const EXTRACT_DIR = path.join(process.cwd(), "data", "extracted");
export const EXTRACT_PROMPT_VERSION = "0.3.1";   // 0.2.0 validated on Vendor B; 0.3.0 adds transitDays/freeDays (optional, additive); 0.3.1 adds brevity limits (no field changes)

// Same schema that was validated live on Vendor B (30/30 prices, units, currency; footnote discount captured as a
// condition, never applied). Kept as plain JSON Schema so both providers can enforce it.
const confidence = { type: "string", enum: ["high", "medium", "low"] };
const evidence = { type: "object", required: ["file", "excerpt"], properties: {
  file: { type: "string" }, excerpt: { type: "string", description: "Verbatim source text. For images: the transcribed text of the row/cell exactly as read." },
  page: { type: "integer" }, locationHint: { type: "string", description: "Where the value sits, e.g. \"FCL table, row 'Nhava Sheva – Rotterdam', 40' column\" or \"p2.l14\"" },
  boundingBox: { type: "object", description: "Images only: region in 0-1000 normalised coordinates (x,y top-left; w,h size).", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] } } };
const UNIT_BASIS = ["per_20GP", "per_40HC", "per_40GP", "per_20ft", "per_40ft", "per_CBM", "per_wm", "per_kg", "per_shipment", "unknown"];
const FLAGS = ["missing", "ambiguous_lane_match", "unit_unstated", "unit_variant", "currency_unstated", "smudged_or_illegible", "footnote_applies", "discount_reference", "prior_rate_reference", "partial_basis", "conflicting_values", "other"];
export const EXTRACTION_SCHEMA = {
  type: "object", required: ["lines", "conditions", "questionnaire", "docSummaries", "readingNotes"],
  properties: {
    lines: { type: "array", description: "Exactly one entry per RFQ lane (flags:['missing'] when not quoted), plus optional lineId=null entries for quotes that could not be matched.", items: { type: "object",
      required: ["lineId", "vendorLaneLabel", "matchedLineConfidence", "price", "currency", "unitBasis", "unitBasisRaw", "inclusions", "exclusions", "confidence", "evidence", "flags"],
      properties: {
        lineId: { type: ["string", "null"], description: "Our RFQ lane id (e.g. \"L07\"), or null if the vendor label cannot be matched confidently." },
        candidateLineIds: { type: "array", items: { type: "string" }, description: "If the vendor label could map to 2+ lanes, list them and set lineId null with flag ambiguous_lane_match." },
        vendorLaneLabel: { type: "string" }, matchedLineConfidence: confidence,
        price: { type: ["number", "null"], description: "The number as printed. null if not quoted or if any digit is unreadable." },
        currency: { type: ["string", "null"], description: "ISO 4217 code as stated (document-level statements count). null if unstated." },
        unitBasis: { type: "string", enum: UNIT_BASIS, description: "Closest bucket for the vendor's stated unit. per_20ft/per_40ft when the vendor says 20'/40' without GP/HC. per_wm for 'per w/m'. Never map to the RFQ unit unless stated." },
        unitBasisRaw: { type: "string", description: "The vendor's unit wording verbatim." },
        inclusions: { type: "array", items: { type: "string" } }, exclusions: { type: "array", items: { type: "string" } },
        confidence, evidence, flags: { type: "array", items: { type: "string", enum: FLAGS } },
        note: { type: "string", description: "Short explanation of any flag, uncertainty, partial reading, or matching judgement." },
        transitDays: { type: ["number", "null"], description: "Transit time in days if the vendor states it for this lane; else null." },
        freeDays: { type: ["number", "null"], description: "Destination free days if stated for this lane; else null." },
      } } },
    conditions: { type: "array", description: "Document-level statements affecting many cells: footnotes, discounts, validity, inclusions/exclusions, surcharges, transit/free-day terms. Captured verbatim, never applied.", items: { type: "object", required: ["kind", "text", "evidence", "appliesTo", "confidence"], properties: {
      kind: { type: "string", enum: ["volume_discount", "validity", "global_inclusion", "global_exclusion", "surcharge", "payment_terms", "transit_time", "free_days", "other"] }, text: { type: "string" }, evidence,
      appliesTo: { type: ["array", "string"], items: { type: "string" }, description: "List of lane ids this could affect, or the string \"all\"." }, confidence,
      discountPct: { type: "number", description: "volume_discount only: percentage as stated. Do not apply it." }, thresholdQty: { type: "number" }, thresholdUnit: { type: "string", description: "e.g. TEU, CBM, shipments" }, thresholdScope: { type: "string", enum: ["programme", "per_lane", "unstated"] } } } },
    questionnaire: { type: "array", items: { type: "object", required: ["questionId", "answerText", "confidence", "flags"], properties: { questionId: { type: "string" }, answerText: { type: ["string", "null"], description: "Verbatim answer, or null if not addressed." }, evidence, confidence, flags: { type: "array", items: { type: "string", enum: ["missing", "contradicts_document", "other"] } } } } },
    docSummaries: { type: "array", items: { type: "object", required: ["file", "kind", "summary", "keyFacts"], properties: { file: { type: "string" }, kind: { type: "string" }, summary: { type: "string" }, keyFacts: { type: "array", items: { type: "object", required: ["label", "value", "evidence"], properties: { label: { type: "string" }, value: { type: "string" }, evidence } } } } } },
    readingNotes: { type: "string", description: "Overall legibility and anything you could not read or were unsure about." },
  },
};

const SYSTEM = fs.readFileSync(path.join(process.cwd(), "lib", "prompts", "extract.md"), "utf8");

export async function extractVendor(rfq: Rfq, vendor: Vendor): Promise<Extraction> {
  const llm = await getLlm();
  const doc = await parseVendorDoc(vendor);
  const lanes = rfq.lines.map(l => ({ lineId: l.sku, mode: l.mode, origin: `${l.origin_name} (${l.origin})`, destination: `${l.destination_name} (${l.destination})`, direction: l.direction, unitRequested: l.uom === "CBM" ? `per CBM (declared density ${l.cargo_density_kg_per_cbm} kg/CBM)` : l.uom === "KG" ? "per kg chargeable" : `per ${l.uom}` }));
  const intro = `RFx sent to the vendor:\n${JSON.stringify({ rfxId: rfq.rfq_id, title: rfq.title, currency: rfq.currency, altCurrencyAccepted: ["USD"], lines: lanes, questionnaire: rfq.quality_questionnaire.map(q => ({ questionId: q.id, text: q.question ?? q.label })) }, null, 1)}\n\nVendor: ${vendor.name} (${vendor.id}). Response format: ${vendor.response_format}. ${doc.note}`;
  const content: LlmContent[] = doc.kind === "text"
    ? [{ type: "text", text: `${intro}\n\n--- DOCUMENT START ---\n${doc.text}\n--- DOCUMENT END ---` }, { type: "text", text: "Record the extraction now as a record_extraction object. One entry per RFQ lane." }]
    : [{ type: "text", text: intro }, { type: "text", text: `Attachment: ${vendor.file} (${doc.media_type})` }, { type: "image", media_type: doc.media_type, base64: doc.base64 }, { type: "text", text: "Record the extraction now as a record_extraction object. One entry per RFQ lane, kept brief as instructed. For every image-sourced value give a short locationHint and a boundingBox; for unquoted lanes give neither." }];
  const data = await llm.extractStructured({ system: SYSTEM, content, schema: EXTRACTION_SCHEMA, toolName: "record_extraction",
    toolDescription: "Record everything the vendor stated in their response, verbatim, one entry per RFQ lane. Never convert units or currency, never apply discounts or footnotes.",
    // Output budget is shared with the model's reasoning tokens on Gemini 3; photographed documents need the most of both.
    maxTokens: doc.kind === "image" && doc.media_type !== "application/pdf" ? 32000 : 16000 }) as Omit<Extraction, "vendor_id" | "source_file" | "extracted_at" | "model">;
  // Any lane the model omitted becomes an explicit, labelled placeholder – never a silent gap.
  const have = new Set((data.lines ?? []).map(l => l.lineId));
  for (const l of rfq.lines) if (!have.has(l.sku)) (data.lines ??= []).push({ lineId: l.sku, vendorLaneLabel: "", matchedLineConfidence: "low", price: null, currency: null, unitBasis: "unknown", unitBasisRaw: "", inclusions: [], exclusions: [], confidence: "low", evidence: { file: vendor.file, excerpt: "" }, flags: ["missing", "other"], note: "Extractor emitted no entry for this lane; placeholder added by extractVendor()." });
  const ex: Extraction = { vendor_id: vendor.id, source_file: vendor.file, extracted_at: new Date().toISOString(), model: `${llm.provider}/${llm.model} · prompt v${EXTRACT_PROMPT_VERSION}`, lines: data.lines, conditions: data.conditions ?? [], questionnaire: data.questionnaire ?? [], docSummaries: data.docSummaries ?? [], readingNotes: data.readingNotes ?? "" };
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(EXTRACT_DIR, `${vendor.id}.json`), JSON.stringify(ex, null, 2));
  return ex;
}
