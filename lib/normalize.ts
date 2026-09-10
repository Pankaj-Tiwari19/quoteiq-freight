import fs from "fs";
import path from "path";
import type { AnswerInterpretation, AssessedAnswer, Basis, Confidence, Dataset, Decision, DocumentCondition, Extraction, ExtractedLine, NormalizedLine, QualityAssessment, QuestionnaireAnswer, ReviewReason, Rfq, RfqLine, StdUnit, Vendor, VendorSummary } from "./types";
import { decisionMap, lineDecisionId, qDecisionId, basisDecisionId } from "./decisions";

// "LLM reads, code computes." Nothing in this file calls a model.
export const LOW_CONFIDENCE = 0.8;         // below this an extracted value must be confirmed by a person
export const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 0.95, medium: 0.8, low: 0.5 };
const UNIT_TO_STD: Partial<Record<ExtractedLine["unitBasis"], StdUnit>> = { per_20GP: "20GP", per_20ft: "20GP", per_40HC: "40HC", per_40ft: "40HC", per_CBM: "CBM", per_wm: "CBM", per_kg: "KG" };

// ---------- loading the layers ----------
export function loadRfq(): Rfq { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "rfq.json"), "utf8")); }
export function loadVendors(): Vendor[] { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "vendors.json"), "utf8")).vendors; }
export function loadExtractions(): Record<string, Extraction> {
  const dir = path.join(process.cwd(), "data", "extracted");
  const out: Record<string, Extraction> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) { const e = upgradeExtraction(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); out[e.vendor_id] = e; }
  return out;
}
/** Accept the three shapes an extraction can arrive in: this app's Extraction, the CLI spike's {run, result}, or a bare ExtractionResult. */
export function upgradeExtraction(raw: any): Extraction {
  let e = raw;
  let meta: Partial<Extraction> = {};
  if (raw && raw.run && raw.result) { meta = { extracted_at: raw.run.finishedAt ?? raw.run.startedAt, model: raw.run.model, source_file: raw.result.lines?.[0]?.evidence?.file }; e = raw.result; }
  const vendor_id = e.vendor_id ?? e.vendorId;
  return {
    vendor_id, source_file: e.source_file ?? meta.source_file ?? e.lines?.[0]?.evidence?.file ?? "", extracted_at: e.extracted_at ?? meta.extracted_at ?? "", model: e.model ?? meta.model ?? "unknown",
    lines: (e.lines ?? []).map((l: any) => ({ ...l, inclusions: l.inclusions ?? [], exclusions: l.exclusions ?? [], flags: l.flags ?? [], evidence: l.evidence ?? { file: "", excerpt: "" } })),
    conditions: e.conditions ?? [], questionnaire: e.questionnaire ?? [], docSummaries: e.docSummaries ?? [], readingNotes: e.readingNotes ?? "",
  };
}

// ---------- programme volume + discounts ----------
/** Programme TEU across all FCL lanes: 40HC/40GP = 2 TEU. This is the agreed reading of "above N TEU" footnotes. */
export function programmeTeu(rfq: Rfq): number { return rfq.lines.filter(l => l.mode === "FCL").reduce((t, l) => t + l.quantity * (l.uom === "40HC" ? 2 : 1), 0); }

/** Charges inside the RFQ's port-to-port all-in scope. An exclusion naming one of these makes the quote partial;
 *  exclusions outside the scope (customs clearance, duties, insurance, inland haulage) do not. Closed list, no prose interpretation. */
const IN_SCOPE_CHARGE = /\b(thc|terminal handling|baf|caf|bunker|documentation|doc(s|umentation)? fee|isps|surcharge|origin handling|destination handling|freight|ocean|port charges?|cfs|ams|ens|seal)\b/;
export function isInScopeExclusion(text: string): boolean { return IN_SCOPE_CHARGE.test(text.toLowerCase()); }
export function basisOf(el: ExtractedLine): Basis {
  const ex = el.exclusions.map(x => x.toLowerCase()).join(" | "); const inc = el.inclusions.map(x => x.toLowerCase()).join(" | ");
  if (/freight only/.test(ex) || /freight only/.test(inc)) return "freight_only";
  const inScope = el.exclusions.filter(isInScopeExclusion);
  if (/all[- ]in/.test(inc) && !inScope.length) return "all_in";
  if (el.flags.includes("partial_basis") || inScope.length) return "partial";
  if (el.inclusions.length) return "all_in";
  return "unstated";
}

/** The vendor's stated volume discount, if any, and whether it applies deterministically under the programme-level reading. */
export function discountFor(ex: Extraction, line: RfqLine | null, teu: number) {
  const c = ex.conditions.find(c => c.kind === "volume_discount");
  if (!c || !c.discountPct) return null;
  const teuBased = (c.thresholdUnit ?? "").toUpperCase() === "TEU" && !!c.thresholdQty;
  const applies = teuBased && (line ? line.mode === "FCL" : true) && (c.appliesTo === "all" || (line ? c.appliesTo.includes(line.sku) : true)) && teu >= (c.thresholdQty ?? Infinity);
  return { pct: c.discountPct, threshold: c.thresholdQty ?? null, unit: c.thresholdUnit ?? null, applied: applies, text: c.text, condition: c as DocumentCondition, teuBased };
}

// ---------- per-line normalization ----------
export function normalizeLine(rfq: Rfq, vendor: Vendor, ex: Extraction, el: ExtractedLine | undefined, line: RfqLine, teu: number, decision: Decision | null, basisDecision: Decision | null = null): NormalizedLine {
  const reasons: ReviewReason[] = []; const trace: string[] = []; const notes: string[] = []; const assumptions: string[] = [];
  const base: NormalizedLine = {
    vendor_id: vendor.id, sku: line.sku, original_value: el?.price ?? null, original_currency: el?.currency ?? "—", original_unit: el?.unitBasisRaw || (el?.unitBasis ?? "—"),
    unit_basis: el?.unitBasis ?? "unknown", normalized_unit: `INR per ${line.uom}`, normalized_value: null, comparable_value: null, basis: el ? basisOf(el) : "unstated",
    fx_rate_applied: null, assumptions, confidence: el ? CONFIDENCE_SCORE[el.confidence] : 0, confidence_label: el?.confidence ?? "low",
    source_document: ex.source_file, source_location: el ? [el.evidence.page ? `page ${el.evidence.page}` : "", el.evidence.locationHint ?? ""].filter(Boolean).join(", ") || "see excerpt" : "not present in document",
    raw_text: el?.evidence.excerpt ?? "", page: el?.evidence.page, evidence_box: el?.evidence.boundingBox, transit_days: el?.transitDays ?? null, free_days: el?.freeDays ?? null,
    review_required: false, review_reasons: reasons, review_note: "", calculation_trace: trace, decision,
  };
  if (!el || el.flags.includes("missing")) { reasons.push("missing_quote"); notes.push("Vendor did not quote this lane."); return finish(base, notes, decision); }
  if (el.note) notes.push(el.note);

  // 1. Review reasons come from typed flags + the confidence label, never from prose.
  if (el.flags.includes("ambiguous_lane_match")) { reasons.push("ambiguous_lane"); notes.push(`Vendor label "${el.vendorLaneLabel}" could be ${el.candidateLineIds?.join(" or ") ?? "more than one lane"}; not assigned.`); return finish(base, notes, decision); }
  if (el.flags.includes("prior_rate_reference")) { reasons.push("unresolvable_reference"); notes.push("Vendor referenced a prior rate instead of quoting a number."); return finish(base, notes, decision); }
  if (el.flags.includes("smudged_or_illegible")) reasons.push("illegible");
  if (el.flags.includes("conflicting_values")) reasons.push("conflicting_values");
  if (el.confidence === "low") reasons.push("low_confidence");

  // 2. A buyer decision may replace or confirm the value (in the vendor's original currency and unit).
  let value = el.price;
  if (decision?.action === "override") { value = decision.value ?? null; trace.push(`Buyer override: ${el.price ?? "—"} → ${value} ${el.currency ?? ""} ${el.unitBasisRaw} (${decision.reason})`); }
  if (decision?.action === "reject") { value = null; notes.push(`Rejected by buyer: ${decision.reason}`); }
  if (value == null) { if (!reasons.length) { reasons.push("missing_quote"); notes.push("No numeric rate found."); } return finish(base, notes, decision); }
  trace.push(`As quoted: ${el.currency ?? "?"} ${value} ${el.unitBasisRaw || el.unitBasis}`);

  // 3. Unit basis -> RFQ unit (deterministic only).
  const std = UNIT_TO_STD[el.unitBasis];
  if (!std) { reasons.push("unit_unstated"); notes.push(`Unit "${el.unitBasisRaw || el.unitBasis}" cannot be mapped to ${line.uom}.`); return finish(base, notes, decision); }
  if (std !== line.uom) { reasons.push("unit_mismatch"); notes.push(`Vendor quoted per ${std}; RFQ asks per ${line.uom}. Not converted.`); return finish(base, notes, decision); }
  let v = value;
  if (el.unitBasis === "per_20ft" || el.unitBasis === "per_40ft") { assumptions.push(`Unit variant: vendor wrote "${el.unitBasisRaw}", read as ${line.uom}`); trace.push(`"${el.unitBasisRaw}" treated as ${line.uom} (assumption recorded)`); }
  if (el.unitBasis === "per_wm") {
    const density = line.cargo_density_kg_per_cbm;
    if (!density) { reasons.push("needs_density"); notes.push("Quoted per w/m; no cargo density declared for this lane."); return finish(base, notes, decision); }
    const factor = Math.max(1, density / 1000);
    assumptions.push(`w/m → per CBM at declared density ${density} kg/CBM (${factor === 1 ? "measure governs, rate unchanged" : `weight governs, ×${factor.toFixed(3)}`})`);
    v = v * factor; trace.push(`per w/m → per CBM ×${factor.toFixed(3)} at ${density} kg/CBM = ${round(v, 2)}`);
  }

  // 4. Currency -> INR at the frozen RFQ rate; no rate = no number.
  const cur = el.currency;
  if (!cur) { reasons.push("currency_unstated"); notes.push("Currency not stated anywhere in the response."); return finish(base, notes, decision); }
  if (cur !== "INR") {
    if (cur !== "USD" || rfq.fx.USD_INR == null) { reasons.push("needs_fx"); notes.push(`Quoted in ${cur}; no ${cur}→INR rate on the RFQ.`); return finish(base, notes, decision); }
    base.fx_rate_applied = rfq.fx.USD_INR; v = v * rfq.fx.USD_INR;
    assumptions.push(`USD→INR at ${rfq.fx.USD_INR} (${rfq.fx.source}, ${rfq.fx.as_of})`); trace.push(`× FX ${rfq.fx.USD_INR} (${rfq.fx.source}) = ${round(v, 2)} INR`);
  }

  // 5. Programme-level volume discount: applied only when TEU-denominated and the programme clears the threshold; otherwise traced, never applied.
  const d = discountFor(ex, line, teu);
  if (d) {
    if (d.applied) { v = v * (1 - d.pct / 100); assumptions.push(`${d.pct}% volume rebate applied: programme ${teu} TEU ≥ ${d.threshold} TEU (vendor: "${d.text.slice(0, 90)}…")`); trace.push(`− ${d.pct}% programme rebate (${teu} TEU ≥ ${d.threshold}) = ${round(v, 2)}`); }
    else if (el.flags.includes("discount_reference") || el.flags.includes("footnote_applies")) trace.push(d.teuBased ? (line.mode !== "FCL" ? `Vendor's ${d.pct}% TEU rebate does not apply to ${line.mode} lanes` : `Vendor's ${d.pct}% rebate NOT applied: programme ${teu} TEU below ${d.threshold} TEU`) : `Vendor's ${d.pct}% discount NOT applied: condition is not TEU-based ("${d.text.slice(0, 80)}…")`);
  }
  base.normalized_value = round(v, 2);

  // 6. Basis: freight-only / partial quotes get a number but are never comparable with all-in quotes.
  if ((base.basis === "freight_only" || base.basis === "partial") && basisDecision?.action === "accept") {
    assumptions.push(`Buyer accepted ${base.basis === "freight_only" ? "freight-only" : "partial"} basis as comparable on ${basisDecision.decided_at.slice(0, 10)}: ${basisDecision.reason}`);
    trace.push(`Basis accepted by buyer as comparable (${basisDecision.reason})`); base.comparable_value = base.normalized_value;
  } else if (base.basis === "freight_only" || base.basis === "partial") {
    reasons.push("basis_mismatch"); notes.push(`${base.basis === "freight_only" ? "Freight only" : "Quoted with exclusions"}: ${el.exclusions.join("; ") || "see vendor terms"}. Not comparable with all-in quotes.`);
    trace.push("Basis differs from all-in: shown for information, excluded from comparison");
  } else { base.comparable_value = base.normalized_value; }
  return finish(base, notes, decision);
}
function finish(n: NormalizedLine, notes: string[], decision: Decision | null): NormalizedLine {
  n.review_reasons = [...new Set(n.review_reasons)];
  n.review_note = notes.join(" ");
  // accept/override clear the flag (reasons stay visible for the audit trail); reject/clarify keep it. A basis mismatch cannot be accepted away: it is a fact about the quote, not a reading.
  const resolvable = n.review_reasons.every(r => r !== "basis_mismatch" && r !== "unit_mismatch");
  const resolved = !!decision && (decision.action === "accept" || decision.action === "override") && n.normalized_value != null && resolvable;
  n.review_required = n.review_reasons.length > 0 && !resolved;
  if (resolved) n.calculation_trace.push(`Buyer ${decision!.action === "accept" ? "accepted" : "overrode"} on ${decision!.decided_at.slice(0, 10)} (${decision!.decided_by}): ${decision!.reason}`);
  return n;
}
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- quality (questionnaire answers are read by the model; pass/fail is decided by the RFQ's pass rules in code) ----------
export function interpretAnswer(rule: RfqQualityRule | undefined, a: QuestionnaireAnswer | undefined): { interpreted: AnswerInterpretation; confidence: number } {
  if (!a || a.answerText == null || a.flags.includes("missing")) return { interpreted: "unanswered", confidence: 0 };
  const conf = CONFIDENCE_SCORE[a.confidence]; const t = a.answerText.toLowerCase();
  if (!rule || rule.type === "manual") return { interpreted: "partial", confidence: conf };
  switch (rule.type) {
    case "boolean": { const yes = /\b(yes|certified|member|we do|holds?|accredited|maintain)\b/.test(t) && !/^\s*(no|not)\b/.test(t) && !/\b(not|no longer|in progress|on request|applying)\b/.test(t); const no = /^\s*no\b|\bnot (certified|a member|available)\b/.test(t); return { interpreted: yes === rule.pass ? "yes" : no ? "no" : "partial", confidence: conf }; }
    case "ratioLte": { const m = t.match(/([\d.]+)\s*%/); const r = m ? Number(m[1]) / 100 : Number((t.match(/[\d.]+/) ?? ["NaN"])[0]); if (Number.isNaN(r)) return { interpreted: "partial", confidence: conf }; return { interpreted: r <= rule.value ? "yes" : "no", confidence: conf }; }
    case "amountGte": { const m = t.replace(/,/g, "").match(/(usd|inr|₹|\$)?\s*([\d.]+)\s*(m|mn|million|cr|crore|lakh)?/); if (!m) return { interpreted: "partial", confidence: conf };
      const mult = ({ m: 1e6, mn: 1e6, million: 1e6, cr: 1e7, crore: 1e7, lakh: 1e5 } as Record<string, number>)[m[3] ?? ""] ?? 1; const v = Number(m[2]) * mult;
      const cur = /inr|₹|crore|cr\b|lakh/.test(t) ? "INR" : "USD";
      if (cur !== rule.currency) return { interpreted: "partial", confidence: conf };   // cross-currency: buyer decides
      return { interpreted: v >= rule.value ? "yes" : "no", confidence: conf }; }
  }
}
type RfqQualityRule = NonNullable<Rfq["quality_questionnaire"][number]["pass_rule"]>;

export function assessQuality(rfq: Rfq, v: Vendor, ex: Extraction | undefined, decisions: Map<string, Decision>): QualityAssessment {
  if (!ex) return { vendor_id: v.id, assessed: false, passed_mandatory: false, failed_criteria: [], criteria_needing_review: [], incomplete_fields: rfq.quality_questionnaire.map(c => c.label), answers: [] };
  const byId = new Map(ex.questionnaire.map(a => [a.questionId, a]));
  const answers: AssessedAnswer[] = []; const failed: string[] = []; const review: string[] = []; const incomplete: string[] = [];
  for (const c of rfq.quality_questionnaire) {
    const a = byId.get(c.id); const d = decisions.get(qDecisionId(v.id, c.id)) ?? null;
    let { interpreted, confidence } = interpretAnswer(c.pass_rule, a);
    if (d?.action === "override" && d.interpreted) { interpreted = d.interpreted; confidence = 1; }
    if (d?.action === "accept") confidence = 1;
    const needsReview = c.mandatory && interpreted === "yes" && confidence < LOW_CONFIDENCE;
    answers.push({ criterion_id: c.id, label: c.label, mandatory: c.mandatory, answer_text: a?.answerText ?? "", interpreted, confidence, source_location: a?.evidence ? [a.evidence.file, a.evidence.page ? `page ${a.evidence.page}` : "", a.evidence.locationHint ?? ""].filter(Boolean).join(", ") : "not found in response", review_required: needsReview, decision: d });
    if (interpreted === "unanswered") incomplete.push(c.label);
    if (c.mandatory && interpreted !== "yes") failed.push(c.label);
    if (needsReview) review.push(c.label);
  }
  return { vendor_id: v.id, assessed: true, passed_mandatory: failed.length === 0 && review.length === 0, failed_criteria: failed, criteria_needing_review: review, incomplete_fields: incomplete, answers };
}

// ---------- assemble the full dataset ----------
export function buildDataset(): Dataset {
  const rfq = loadRfq(); const vendors = loadVendors(); const extractions = loadExtractions(); const decisions = decisionMap();
  const teu = programmeTeu(rfq);
  const normalized: NormalizedLine[] = []; const summaries: VendorSummary[] = [];
  for (const v of vendors) {
    const ex = extractions[v.id]; const quality = assessQuality(rfq, v, ex, decisions);
    if (!ex) { summaries.push({ vendor_id: v.id, name: v.name, format: v.response_format, lines_quoted: 0, lines_missing: rfq.lines.map(l => l.sku), lines_needing_review: [], currency: "—", basis: "unstated", discount: null, transit_days_max: null, basis_decision: null, quality, extracted: false }); continue; }
    const byId = new Map<string, ExtractedLine>(); const ambiguous: ExtractedLine[] = [];
    for (const l of ex.lines) { if (l.lineId) byId.set(l.lineId.toUpperCase(), l); else ambiguous.push(l); }
    const missing: string[] = []; const review: string[] = [];
    for (const l of rfq.lines) {
      const e = byId.get(l.sku) ?? ambiguous.find(a => a.candidateLineIds?.includes(l.sku));
      const n = normalizeLine(rfq, v, ex, e, l, teu, decisions.get(lineDecisionId(v.id, l.sku)) ?? null, decisions.get(basisDecisionId(v.id)) ?? null);
      if (n.review_reasons.includes("missing_quote")) missing.push(l.sku); else if (n.review_required) review.push(l.sku);
      normalized.push(n);
    }
    const currencies = [...new Set(ex.lines.map(l => l.currency).filter(Boolean))] as string[];
    const bases = normalized.filter(n => n.vendor_id === v.id && n.original_value != null).map(n => n.basis);
    const basis: Basis = bases.every(b => b === "all_in") ? "all_in" : bases.every(b => b === "freight_only") ? "freight_only" : bases.some(b => b === "freight_only" || b === "partial") ? "partial" : "unstated";
    const d = discountFor(ex, null, teu);
    const transit = ex.lines.map(l => l.transitDays).filter((x): x is number => typeof x === "number");
    summaries.push({ vendor_id: v.id, name: v.name, format: v.response_format, lines_quoted: rfq.lines.length - missing.length, lines_missing: missing, lines_needing_review: review, currency: currencies.join("/") || "—", basis, discount: d ? { pct: d.pct, threshold: d.threshold, unit: d.unit, applied: d.applied, text: d.text } : null, transit_days_max: transit.length ? Math.max(...transit) : null, basis_decision: decisions.get(basisDecisionId(v.id)) ?? null, quality, extracted: true });
  }
  return { rfq, vendors, extractions, normalized, summaries, programme_teu: teu };
}
