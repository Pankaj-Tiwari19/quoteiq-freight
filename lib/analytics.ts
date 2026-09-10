import type { Dataset, NormalizedLine } from "./types";
import { reasonLabel } from "./format";

// Deterministic queries shared by the comparison, the analyst and the award. The analyst LLM only ever sees the results of these.
export interface Opts { quality_only?: boolean; exclude_review?: boolean; basis?: "comparable" | "converted"; }
/** "comparable" = all-in quotes only (freight-only/partial quotes have no comparable number). "converted" = every converted number, including non-comparable ones – for information, never for ranking by default. */
const val = (n: NormalizedLine, basis: "comparable" | "converted") => basis === "converted" ? n.normalized_value : n.comparable_value;

export function eligibleVendors(ds: Dataset, o: Opts) {
  return ds.summaries.filter(s => s.extracted && (!o.quality_only || s.quality.passed_mandatory)).map(s => s.vendor_id);
}
function candidates(ds: Dataset, sku: string, o: Opts) {
  const vs = new Set(eligibleVendors(ds, o)); const basis = o.basis ?? "comparable";
  return ds.normalized.filter(n => n.sku === sku && vs.has(n.vendor_id) && val(n, basis) != null && (!o.exclude_review || !n.review_required))
    .map(n => ({ vendor_id: n.vendor_id, price: val(n, basis)!, review_required: n.review_required, confidence: n.confidence, basis: n.basis, assumptions: n.assumptions }))
    .sort((a, b) => a.price - b.price);
}

export function cheapestPerLine(ds: Dataset, o: Opts = {}) {
  return ds.rfq.lines.map(l => {
    const c = candidates(ds, l.sku, o);
    const best = c[0];
    const excluded = ds.normalized.filter(n => n.sku === l.sku && eligibleVendors(ds, o).includes(n.vendor_id) && !c.some(x => x.vendor_id === n.vendor_id)).map(n => ({ vendor_id: n.vendor_id, why: n.review_reasons.map(r => reasonLabel[r] ?? r).join(", ") || "no comparable number" }));
    return { sku: l.sku, lane: l.description, unit: l.uom, quantity: l.quantity, vendor_id: best?.vendor_id ?? null, unit_price_inr: best?.price ?? null,
      line_total_inr: best ? round(best.price * l.quantity) : null, review_required: best?.review_required ?? false, assumptions: best?.assumptions ?? [],
      runner_up: c[1] ? { vendor_id: c[1].vendor_id, unit_price_inr: c[1].price } : null, candidates: c.length, unquoted_by_eligible: c.length === 0, excluded };
  });
}

export function vendorTotals(ds: Dataset, o: Opts = {}) {
  const basis = o.basis ?? "comparable";
  return eligibleVendors(ds, o).map(vid => {
    const lines = ds.normalized.filter(n => n.vendor_id === vid);
    const priced = lines.filter(n => val(n, basis) != null && (!o.exclude_review || !n.review_required));
    const total = priced.reduce((s, n) => s + val(n, basis)! * qty(ds, n.sku), 0);
    return { vendor_id: vid, name: name(ds, vid), lines_priced: priced.length, lines_total: lines.length, complete: priced.length === lines.length,
      total_inr: round(total), lines_review: lines.filter(n => n.review_required && val(n, basis) != null).length,
      lines_not_comparable: lines.filter(n => val(n, basis) == null).map(n => n.sku) };
  }).sort((a, b) => a.total_inr - b.total_inr);
}

/** Savings of a lane-by-lane split award vs the best complete single-vendor award. */
export function splitAwardSavings(ds: Dataset, o: Opts = {}) {
  const per = cheapestPerLine(ds, o);
  const covered = per.filter(p => p.line_total_inr != null);
  const splitTotal = round(covered.reduce((s, p) => s + p.line_total_inr!, 0));
  const totals = vendorTotals(ds, o);
  const completeVendors = totals.filter(t => t.complete);
  const bestSingle = completeVendors[0] ?? null;
  const singleOnCovered = bestSingle ? round(ds.normalized.filter(n => n.vendor_id === bestSingle.vendor_id && covered.some(c => c.sku === n.sku)).reduce((s, n) => s + (val(n, o.basis ?? "comparable") ?? 0) * qty(ds, n.sku), 0)) : null;
  const allocation: Record<string, { lines: string[]; total_inr: number }> = {};
  for (const p of covered) { const a = (allocation[p.vendor_id!] ??= { lines: [], total_inr: 0 }); a.lines.push(p.sku); a.total_inr = round(a.total_inr + p.line_total_inr!); }
  return { lines_covered: covered.length, lines_uncovered: per.filter(p => p.line_total_inr == null).map(p => p.sku),
    split_total_inr: splitTotal, best_single_vendor: bestSingle ? { vendor_id: bestSingle.vendor_id, name: bestSingle.name, total_inr: singleOnCovered } : null,
    savings_inr: bestSingle && singleOnCovered != null ? round(singleOnCovered - splitTotal) : null,
    savings_percent: bestSingle && singleOnCovered ? round(((singleOnCovered - splitTotal) / singleOnCovered) * 100, 2) : null,
    allocation, lines_in_split_needing_review: covered.filter(p => p.review_required).map(p => p.sku), vendor_totals: totals };
}

export function incompleteVendors(ds: Dataset) {
  return ds.summaries.filter(s => !s.extracted || s.lines_missing.length > 0 || s.lines_needing_review.length > 0 || s.quality.incomplete_fields.length > 0)
    .map(s => ({ vendor_id: s.vendor_id, name: s.name, extracted: s.extracted, lines_quoted: s.lines_quoted, lines_missing: s.lines_missing, lines_under_review: s.lines_needing_review, questionnaire_unanswered: s.quality.incomplete_fields }));
}

export function decisionsLog(ds: Dataset) {
  const lines = ds.normalized.filter(n => n.decision).map(n => ({ vendor_id: n.vendor_id, target: n.sku, action: n.decision!.action, original_value: n.original_value, override_value: n.decision!.value ?? null, reason: n.decision!.reason, decided_by: n.decision!.decided_by, decided_at: n.decision!.decided_at }));
  const basis = ds.summaries.filter(s => s.basis_decision).map(s => ({ vendor_id: s.vendor_id, target: `basis: ${s.basis.replace("_", " ")} accepted as comparable`, action: s.basis_decision!.action, original_value: s.basis as string | number | null, override_value: null as string | number | null, reason: s.basis_decision!.reason, decided_by: s.basis_decision!.decided_by, decided_at: s.basis_decision!.decided_at }));
  const qs = ds.summaries.flatMap(s => s.quality.answers.filter(a => a.decision).map(a => ({ vendor_id: s.vendor_id, target: `questionnaire: ${a.label}`, action: a.decision!.action, original_value: a.answer_text, override_value: a.decision!.interpreted ?? null, reason: a.decision!.reason, decided_by: a.decision!.decided_by, decided_at: a.decision!.decided_at })));
  return [...lines, ...basis, ...qs];
}

/** What-if: which award lanes change if a specific vendor's review items were all accepted (basis mismatches cannot be accepted away). */
export function whatIfAccept(ds: Dataset, vendor_id: string) {
  const before = cheapestPerLine(ds, { quality_only: true, exclude_review: true });
  const relaxed = cheapestPerLine({ ...ds, normalized: ds.normalized.map(n => n.vendor_id === vendor_id && n.review_required && n.comparable_value != null ? { ...n, review_required: false } : n) }, { quality_only: true, exclude_review: true });
  const changed = relaxed.filter((r, i) => r.vendor_id !== before[i].vendor_id || r.unit_price_inr !== before[i].unit_price_inr).map(r => { const b = before.find(x => x.sku === r.sku)!; return { sku: r.sku, from: b.vendor_id, from_price: b.unit_price_inr, to: r.vendor_id, to_price: r.unit_price_inr, line_saving_inr: b.line_total_inr != null && r.line_total_inr != null ? round(b.line_total_inr - r.line_total_inr) : null }; });
  return { vendor_id, lines_changed: changed.length, total_saving_inr: round(changed.reduce((s, c) => s + (c.line_saving_inr ?? 0), 0)), changes: changed };
}

export function lowConfidence(ds: Dataset, threshold = 0.8) {
  return ds.normalized.filter(n => n.confidence < threshold && !n.review_reasons.includes("missing_quote"))
    .map(n => ({ vendor_id: n.vendor_id, sku: n.sku, confidence: n.confidence, confidence_label: n.confidence_label, original_value: n.original_value, original_unit: n.original_unit, normalized_inr_per_unit: n.normalized_value, source: `${n.source_document} – ${n.source_location}`, raw_text: n.raw_text, review_reasons: n.review_reasons, note: n.review_note }))
    .sort((a, b) => a.confidence - b.confidence);
}

/** Every value flagged for human review with the reason. This is exactly the set of amber cells in the comparison. */
export function reviewItems(ds: Dataset) {
  return ds.normalized.filter(n => n.review_required && !n.review_reasons.includes("missing_quote"))
    .map(n => ({ vendor_id: n.vendor_id, sku: n.sku, reasons: n.review_reasons, reasons_label: n.review_reasons.map(r => reasonLabel[r] ?? r), note: n.review_note, original_value: n.original_value, original_unit: n.original_unit, currency: n.original_currency, raw_text: n.raw_text, source: `${n.source_document} – ${n.source_location}`, confidence: n.confidence }));
}

export function qualityStatus(ds: Dataset) {
  return ds.summaries.map(s => ({ vendor_id: s.vendor_id, name: s.name, assessed: s.quality.assessed, passed_mandatory: s.quality.passed_mandatory, failed: s.quality.failed_criteria, needs_review: s.quality.criteria_needing_review, unanswered: s.quality.incomplete_fields,
    answers: s.quality.answers.map(a => ({ criterion: a.label, mandatory: a.mandatory, interpreted: a.interpreted, answer_text: a.answer_text, confidence: a.confidence, source: a.source_location, decided: a.decision?.action ?? null })) }));
}

export function vendorSummaries(ds: Dataset) {
  return ds.summaries.map(s => ({ ...s, quality: { passed_mandatory: s.quality.passed_mandatory, failed: s.quality.failed_criteria }, conditions: ds.extractions[s.vendor_id]?.conditions.map(c => ({ kind: c.kind, text: c.text })) ?? [], reading_notes: ds.extractions[s.vendor_id]?.readingNotes ?? "" }));
}

export function lineDetail(ds: Dataset, sku: string) {
  const l = ds.rfq.lines.find(x => x.sku === sku.toUpperCase());
  if (!l) return { error: `Unknown lane ${sku}` };
  return { ...l, quotes: ds.normalized.filter(n => n.sku === l.sku).map(n => ({ vendor_id: n.vendor_id, original: n.original_value == null ? null : `${n.original_value} ${n.original_currency} ${n.original_unit}`, basis: n.basis, converted_inr_per_unit: n.normalized_value, comparable_inr_per_unit: n.comparable_value, confidence: n.confidence_label, review: n.review_reasons, assumptions: n.assumptions, source: n.source_location, excerpt: n.raw_text, trace: n.calculation_trace })) };
}

/** FX sensitivity: comparable totals per vendor at −5% / base / +5% USD→INR. INR-quoted cells do not move. Code, not the model. */
export function fxSensitivity(ds: Dataset, o: Opts = {}) {
  const base = ds.rfq.fx.USD_INR; if (base == null) return { error: "No USD→INR rate on the RFQ; nothing to flex." };
  const at = (rate: number) => {
    const normalized = ds.normalized.map(n => n.fx_rate_applied == null ? n : { ...n, normalized_value: n.normalized_value == null ? null : round(n.normalized_value / base * rate), comparable_value: n.comparable_value == null ? null : round(n.comparable_value / base * rate) });
    const d = { ...ds, normalized };
    return { rate, vendor_totals: vendorTotals(d, o).map(t => ({ vendor_id: t.vendor_id, total_inr: t.total_inr, lines_priced: t.lines_priced })), split_total_inr: splitAwardSavings(d, o).split_total_inr };
  };
  return { minus5: at(round(base * 0.95, 4)), base: at(base), plus5: at(round(base * 1.05, 4)) };
}

/** Risk register – deterministic facts the LLM can reason about. */
export function risks(ds: Dataset) {
  const out: { severity: "high" | "medium" | "low"; vendor_id: string | null; risk: string; evidence: string }[] = [];
  for (const s of ds.summaries) {
    if (!s.extracted) { out.push({ severity: "high", vendor_id: s.vendor_id, risk: "Response not extracted", evidence: "Not in any comparison or award" }); continue; }
    if (!s.quality.passed_mandatory) out.push({ severity: "high", vendor_id: s.vendor_id, risk: "Does not pass mandatory questionnaire criteria", evidence: [...s.quality.failed_criteria, ...s.quality.criteria_needing_review.map(c => `${c} (unconfirmed yes)`)].join("; ") });
    if (s.quality.incomplete_fields.length) out.push({ severity: "medium", vendor_id: s.vendor_id, risk: "Questionnaire incomplete", evidence: s.quality.incomplete_fields.join("; ") });
    if ((s.basis === "freight_only" || s.basis === "partial") && !s.basis_decision) { const n = ds.normalized.filter(x => x.vendor_id === s.vendor_id && x.review_reasons.includes("basis_mismatch")).length; out.push({ severity: "high", vendor_id: s.vendor_id, risk: `${s.basis === "freight_only" ? "Freight-only" : "Partial-basis"} quote on ${n} lanes – not comparable with all-in quotes`, evidence: "THC / surcharges are extra; a like-for-like number needs the vendor's surcharge schedule, or a buyer decision to accept the basis" }); }
    if (s.basis_decision) out.push({ severity: "medium", vendor_id: s.vendor_id, risk: `${s.basis.replace("_", " ")} basis accepted as comparable by the buyer`, evidence: `${s.basis_decision.reason} (${s.basis_decision.decided_by}, ${s.basis_decision.decided_at.slice(0, 10)}); the excluded charges are not in these numbers` });
    if (s.discount && !s.discount.applied) out.push({ severity: "low", vendor_id: s.vendor_id, risk: `${s.discount.pct}% discount not applied`, evidence: s.discount.text });
    if (s.discount && s.discount.applied) out.push({ severity: "low", vendor_id: s.vendor_id, risk: `${s.discount.pct}% programme rebate applied to FCL lanes (assumption)`, evidence: `Programme ${ds.programme_teu} TEU ≥ ${s.discount.threshold} ${s.discount.unit}; rebate is settled per the vendor's terms` });
    if (s.lines_missing.length) out.push({ severity: "medium", vendor_id: s.vendor_id, risk: `Did not quote ${s.lines_missing.length} lanes`, evidence: s.lines_missing.join(", ") });
    if (s.transit_days_max != null && ds.rfq.max_transit_days != null && s.transit_days_max > ds.rfq.max_transit_days) out.push({ severity: "medium", vendor_id: s.vendor_id, risk: "Transit time exceeds requirement on at least one lane", evidence: `${s.transit_days_max} days vs ${ds.rfq.max_transit_days} max` });
    if (/USD/.test(s.currency)) out.push({ severity: "low", vendor_id: s.vendor_id, risk: "FX exposure", evidence: ds.rfq.fx.USD_INR == null ? "Quoted in USD; no rate entered, so nothing is comparable yet" : `Quoted in USD; evaluated at ${ds.rfq.fx.USD_INR} (${ds.rfq.fx.as_of}); ±5% moves USD lanes proportionally` });
    const rv = ds.normalized.filter(n => n.vendor_id === s.vendor_id && n.review_required && !n.review_reasons.includes("missing_quote") && !n.review_reasons.includes("basis_mismatch"));
    if (rv.length) out.push({ severity: "medium", vendor_id: s.vendor_id, risk: `${rv.length} values need human review`, evidence: rv.map(n => `${n.sku}: ${n.review_reasons.map(r => reasonLabel[r] ?? r).join("/")}`).join("; ") });
    const withAssump = ds.normalized.filter(n => n.vendor_id === s.vendor_id && n.assumptions.length && n.comparable_value != null).length;
    if (withAssump) out.push({ severity: "low", vendor_id: s.vendor_id, risk: `${withAssump} comparable values carry assumptions`, evidence: [...new Set(ds.normalized.filter(n => n.vendor_id === s.vendor_id).flatMap(n => n.assumptions.map(a => a.split(":")[0])))].join("; ") });
  }
  return out;
}

const qty = (ds: Dataset, sku: string) => ds.rfq.lines.find(l => l.sku === sku)?.quantity ?? 0;
const name = (ds: Dataset, vid: string) => ds.vendors.find(v => v.id === vid)?.name ?? vid;
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
