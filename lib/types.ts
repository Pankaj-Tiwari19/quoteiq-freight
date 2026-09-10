// ---------- Layer 1: RFQ truth (what the buyer asked for) ----------
// Field names `sku` / `quantity` / `uom` are kept from the original app so screens and analytics stay unchanged:
//   sku = lane id (L01..L30), quantity = annual programme volume in the lane's unit, uom = the unit every quote is normalised to.
export type StdUnit = "20GP" | "40HC" | "CBM" | "KG";
export type Mode = "FCL" | "LCL" | "AIR";
export interface RfqLine {
  sku: string; description: string; quantity: number; uom: StdUnit;
  mode: Mode; origin: string; origin_name: string; destination: string; destination_name: string; direction: "export" | "import";
  cargo_density_kg_per_cbm?: number;      // LCL only: buyer-declared density, makes "per w/m" quotes convertible with a recorded assumption
}
export type PassRule =
  | { type: "boolean"; pass: boolean }
  | { type: "amountGte"; value: number; currency: string }
  | { type: "ratioLte"; value: number }
  | { type: "manual" };
export interface QualityCriterion { id: string; label: string; mandatory: boolean; question?: string; pass_rule?: PassRule; }
export interface Rfq {
  rfq_id: string; title: string; category: string; buyer: string; currency: "INR";
  issued_on: string; due_on: string; status: string; incoterm: string;
  max_transit_days: number | null;       // buyer's ceiling on port-to-port transit (surfaced as a risk, not a hard gate)
  fx: { USD_INR: number | null; as_of: string; source: string };   // null = not entered yet: USD quotes stay "needs FX"
  quality_questionnaire: QualityCriterion[];
  lines: RfqLine[];
}

// ---------- Layer 2: Vendor source data (what the vendor actually sent) ----------
export type ResponseFormat = "xlsx" | "pdf" | "docx" | "image" | "email";
export interface Vendor {
  id: string; name: string; location: string; response_format: ResponseFormat; file: string;
  received_on: string; attachments?: string[]; email?: string;
  questionnaire_note?: string;
}

// ---------- LLM extraction output (structured, per document) ----------
// This is the schema validated live on Vendor B (30/30 prices, units, currency; discount captured as a condition,
// never applied). The extractor records what the vendor SAID; every conversion happens in normalize.ts.
export type Confidence = "high" | "medium" | "low";
export type UnitBasis = "per_20GP" | "per_40HC" | "per_40GP" | "per_20ft" | "per_40ft" | "per_CBM" | "per_wm" | "per_kg" | "per_shipment" | "unknown";
/** Closed vocabulary of things the extractor may observe. Normalization maps these to review reasons; no regex over prose. */
export type ExtractFlag =
  | "missing" | "ambiguous_lane_match" | "unit_unstated" | "unit_variant" | "currency_unstated" | "smudged_or_illegible"
  | "footnote_applies" | "discount_reference" | "prior_rate_reference" | "partial_basis" | "conflicting_values" | "other";
export interface Evidence { file: string; excerpt: string; page?: number; locationHint?: string; boundingBox?: { x: number; y: number; w: number; h: number }; }
export interface ExtractedLine {
  lineId: string | null;            // RFQ lane id, or null when the vendor label could not be matched confidently
  candidateLineIds?: string[];      // when ambiguous: the lanes it could be
  vendorLaneLabel: string;
  matchedLineConfidence: Confidence;
  price: number | null;             // exactly as written; null if not quoted or any digit unreadable
  currency: string | null;
  unitBasis: UnitBasis; unitBasisRaw: string;
  inclusions: string[]; exclusions: string[];
  confidence: Confidence;
  evidence: Evidence;
  flags: ExtractFlag[];
  note?: string;
  transitDays?: number | null;      // as stated by the vendor for this lane, if stated
  freeDays?: number | null;         // destination free days, if stated
}
export interface DocumentCondition {
  kind: "volume_discount" | "validity" | "global_inclusion" | "global_exclusion" | "surcharge" | "payment_terms" | "transit_time" | "free_days" | "other";
  text: string; evidence: Evidence; appliesTo: string[] | "all"; confidence: Confidence;
  discountPct?: number; thresholdQty?: number; thresholdUnit?: string; thresholdScope?: "programme" | "per_lane" | "unstated";
}
export interface QuestionnaireAnswer { questionId: string; answerText: string | null; evidence?: Evidence; confidence: Confidence; flags: ("missing" | "contradicts_document" | "other")[]; }
export interface DocSummary { file: string; kind: string; summary: string; keyFacts: { label: string; value: string; evidence: Evidence }[]; }
export interface Extraction {
  vendor_id: string; source_file: string; extracted_at: string; model: string;
  lines: ExtractedLine[]; conditions: DocumentCondition[]; questionnaire: QuestionnaireAnswer[]; docSummaries: DocSummary[]; readingNotes: string;
}

// ---------- Layer 3: Normalized data (what the system interpreted) ----------
export type ReviewReason =
  | "missing_quote" | "ambiguous_lane" | "illegible" | "low_confidence" | "unit_mismatch" | "unit_unstated" | "currency_unstated"
  | "basis_mismatch" | "needs_fx" | "needs_density" | "unresolvable_reference" | "conflicting_values";
export type Basis = "all_in" | "freight_only" | "partial" | "unstated";
export interface NormalizedLine {
  vendor_id: string; sku: string;
  original_value: number | null; original_currency: string; original_unit: string;   // original_unit = vendor's wording verbatim
  unit_basis: UnitBasis;
  normalized_unit: string;                // e.g. "INR per 40HC"
  normalized_value: number | null;        // INR per RFQ unit after unit/FX/discount, whatever the basis
  comparable_value: number | null;        // same number when the quote is all-in and comparable; null for freight-only/partial quotes
  basis: Basis;
  fx_rate_applied: number | null;
  assumptions: string[];                  // FX, unit variant, density, programme discount – every one recorded
  confidence: number;                     // high 0.95 / medium 0.8 / low 0.5, from the extractor's label
  confidence_label: Confidence;
  source_document: string; source_location: string; raw_text: string; page?: number;
  evidence_box?: { x: number; y: number; w: number; h: number };
  transit_days: number | null; free_days: number | null;
  review_required: boolean; review_reasons: ReviewReason[]; review_note: string;
  calculation_trace: string[];
  decision: Decision | null;
}
// ---------- Buyer decisions (the human half of the loop) ----------
export interface Decision {
  id: string; vendor_id: string; target: { kind: "line"; sku: string } | { kind: "questionnaire"; criterion_id: string } | { kind: "basis" };   // basis: buyer accepts this vendor's freight-only/partial basis as comparable (an assumption recorded on every cell)
  action: "accept" | "override" | "reject" | "clarify";
  value?: number | null;                  // override value in the vendor's ORIGINAL currency and unit
  interpreted?: AnswerInterpretation;
  reason: string; decided_by: string; decided_at: string;
}
export type AnswerInterpretation = "yes" | "no" | "partial" | "unanswered";
export interface AssessedAnswer { criterion_id: string; label: string; mandatory: boolean; answer_text: string; interpreted: AnswerInterpretation; confidence: number; source_location: string; review_required: boolean; decision: Decision | null; }
export interface QualityAssessment {
  vendor_id: string; assessed: boolean; passed_mandatory: boolean;
  failed_criteria: string[]; criteria_needing_review: string[]; incomplete_fields: string[]; answers: AssessedAnswer[];
}
export interface VendorSummary {
  vendor_id: string; name: string; format: ResponseFormat;
  lines_quoted: number; lines_missing: string[]; lines_needing_review: string[];
  currency: string; basis: Basis;
  discount: { pct: number; threshold: number | null; unit: string | null; applied: boolean; text: string } | null;
  transit_days_max: number | null;
  basis_decision: Decision | null;
  quality: QualityAssessment;
  extracted: boolean;
}
export interface Dataset {
  rfq: Rfq; vendors: Vendor[]; extractions: Record<string, Extraction>;
  normalized: NormalizedLine[]; summaries: VendorSummary[];
  programme_teu: number;
}
