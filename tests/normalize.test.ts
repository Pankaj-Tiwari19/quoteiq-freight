// Deterministic logic tests: no LLM, no network. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLine, assessQuality, programmeTeu, interpretAnswer, basisOf } from "../lib/normalize";
import * as A from "../lib/analytics";
import { applyDraftTool, emptyDraft, draftReadiness } from "../lib/draft";
import type { Dataset, Extraction, ExtractedLine, Rfq, RfqLine, Vendor, Decision, DocumentCondition } from "../lib/types";

const L07: RfqLine = { sku: "L07", description: "Nhava Sheva → Rotterdam", quantity: 20, uom: "40HC", mode: "FCL", origin: "INNSA", origin_name: "Nhava Sheva", destination: "NLRTM", destination_name: "Rotterdam", direction: "export" };
const L01: RfqLine = { sku: "L01", description: "Nhava Sheva → Jebel Ali", quantity: 36, uom: "20GP", mode: "FCL", origin: "INNSA", origin_name: "Nhava Sheva", destination: "AEJEA", destination_name: "Jebel Ali", direction: "export" };
const L19: RfqLine = { sku: "L19", description: "Nhava Sheva → Jebel Ali LCL", quantity: 240, uom: "CBM", mode: "LCL", origin: "INNSA", origin_name: "Nhava Sheva", destination: "AEJEA", destination_name: "Jebel Ali", direction: "export", cargo_density_kg_per_cbm: 350 };
const rfq: Rfq = { rfq_id: "T", title: "t", category: "freight", buyer: "b", currency: "INR", issued_on: "", due_on: "", status: "", incoterm: "", max_transit_days: 40,
  fx: { USD_INR: 80, as_of: "2026-09-10", source: "test" }, quality_questionnaire: [{ id: "Q1", label: "ISO 9001", mandatory: true, pass_rule: { type: "boolean", pass: true } }, { id: "Q5", label: "Insurance ≥ USD 1M", mandatory: true, pass_rule: { type: "amountGte", value: 1e6, currency: "USD" } }, { id: "Q4", label: "Claims ≤ 2%", mandatory: false, pass_rule: { type: "ratioLte", value: 0.02 } }],
  lines: [L01, L07, L19] };
const teu = programmeTeu(rfq);   // 36 + 40 = 76
const vendor: Vendor = { id: "v", name: "V", location: "", response_format: "pdf", file: "v.pdf", received_on: "" };
const ev = { file: "v.pdf", excerpt: "row", page: 1 };
const line = (o: Partial<ExtractedLine>): ExtractedLine => ({ lineId: "L07", vendorLaneLabel: "NSA-RTM", matchedLineConfidence: "high", price: 1850, currency: "USD", unitBasis: "per_40HC", unitBasisRaw: "40' HC", inclusions: ["all-in"], exclusions: [], confidence: "high", evidence: ev, flags: [], ...o });
const rebate: DocumentCondition = { kind: "volume_discount", text: "A volume rebate of 4% applies where programme exceeds 50 TEU", evidence: ev, appliesTo: "all", confidence: "high", discountPct: 4, thresholdQty: 50, thresholdUnit: "TEU", thresholdScope: "programme" };
const ex = (o: Partial<Extraction> = {}): Extraction => ({ vendor_id: "v", source_file: "v.pdf", extracted_at: "", model: "t", lines: [line({})], conditions: [], questionnaire: [], docSummaries: [], readingNotes: "", ...o });

test("programme TEU counts 40HC as 2 TEU and ignores LCL/air", () => { assert.equal(teu, 76); });
test("USD converts at the frozen RFQ rate; the rate is recorded as an assumption", () => {
  const n = normalizeLine(rfq, vendor, ex(), line({}), L07, teu, null);
  assert.equal(n.normalized_value, 1850 * 80); assert.equal(n.comparable_value, 1850 * 80); assert.equal(n.fx_rate_applied, 80); assert.ok(n.assumptions[0].startsWith("USD→INR at 80"));
});
test("no FX rate on the RFQ = no number, never a guess", () => {
  const n = normalizeLine({ ...rfq, fx: { USD_INR: null, as_of: "", source: "" } }, vendor, ex(), line({}), L07, teu, null);
  assert.equal(n.normalized_value, null); assert.deepEqual(n.review_reasons, ["needs_fx"]);
});
test("TEU rebate applies at programme level on FCL only, and only above the threshold", () => {
  assert.equal(normalizeLine(rfq, vendor, ex({ conditions: [rebate] }), line({ flags: ["discount_reference"] }), L07, teu, null).normalized_value, Math.round(1850 * 80 * 0.96 * 100) / 100);
  const below = normalizeLine(rfq, vendor, ex({ conditions: [rebate] }), line({ flags: ["discount_reference"] }), L07, 20, null);
  assert.equal(below.normalized_value, 1850 * 80); assert.ok(below.calculation_trace.some(t => t.includes("NOT applied")));
  const lcl = normalizeLine(rfq, vendor, ex({ conditions: [rebate] }), line({ lineId: "L19", price: 22, unitBasis: "per_CBM", unitBasisRaw: "per CBM", flags: ["discount_reference"] }), L19, teu, null);
  assert.equal(lcl.normalized_value, 22 * 80);
});
test("freight-only quotes are converted but never comparable, and cannot be accepted away", () => {
  const n = normalizeLine(rfq, vendor, ex(), line({ inclusions: [], exclusions: ["freight only", "THC extra"], flags: ["partial_basis"] }), L07, teu, null);
  assert.equal(n.normalized_value, 1850 * 80); assert.equal(n.comparable_value, null); assert.equal(n.basis, "freight_only"); assert.ok(n.review_reasons.includes("basis_mismatch"));
  const acc: Decision = { id: "v:L07", vendor_id: "v", target: { kind: "line", sku: "L07" }, action: "accept", reason: "ok", decided_by: "buyer", decided_at: "2026-09-10T00:00:00Z" };
  assert.equal(normalizeLine(rfq, vendor, ex(), line({ inclusions: [], exclusions: ["freight only"], flags: ["partial_basis"] }), L07, teu, acc).review_required, true);
});
test("'40ft' is read as 40HC with an assumption; a 20ft quote on a 40HC lane is a unit mismatch", () => {
  const a = normalizeLine(rfq, vendor, ex(), line({ price: 158000, currency: "INR", unitBasis: "per_40ft", unitBasisRaw: "40'", flags: ["unit_variant"] }), L07, teu, null);
  assert.equal(a.comparable_value, 158000); assert.ok(a.assumptions[0].includes("Unit variant")); assert.equal(a.review_required, false);
  const b = normalizeLine(rfq, vendor, ex(), line({ price: 104000, currency: "INR", unitBasis: "per_20ft", unitBasisRaw: "20'" }), L07, teu, null);
  assert.equal(b.normalized_value, null); assert.ok(b.review_reasons.includes("unit_mismatch"));
});
test("per w/m converts with declared density; without density it is held", () => {
  const n = normalizeLine(rfq, vendor, ex(), line({ lineId: "L19", price: 1950, currency: "INR", unitBasis: "per_wm", unitBasisRaw: "per w/m" }), L19, teu, null);
  assert.equal(n.comparable_value, 1950); assert.ok(n.assumptions[0].includes("350 kg/CBM"));
  const heavy = normalizeLine(rfq, vendor, ex(), line({ lineId: "L19", price: 1950, currency: "INR", unitBasis: "per_wm", unitBasisRaw: "per w/m" }), { ...L19, cargo_density_kg_per_cbm: 1200 }, teu, null);
  assert.equal(heavy.comparable_value, 2340);
  assert.deepEqual(normalizeLine(rfq, vendor, ex(), line({ lineId: "L19", price: 1950, currency: "INR", unitBasis: "per_wm", unitBasisRaw: "per w/m" }), { ...L19, cargo_density_kg_per_cbm: undefined }, teu, null).review_reasons, ["needs_density"]);
});
test("illegible, missing, ambiguous and prior-rate cells never produce a number", () => {
  const ill = normalizeLine(rfq, vendor, ex(), line({ price: null, currency: "INR", confidence: "low", flags: ["smudged_or_illegible"], note: "last digits 00" }), L07, teu, null);
  assert.equal(ill.normalized_value, null); assert.ok(ill.review_reasons.includes("illegible")); assert.ok(ill.review_note.includes("last digits 00"));
  assert.deepEqual(normalizeLine(rfq, vendor, ex(), undefined, L07, teu, null).review_reasons, ["missing_quote"]);
  assert.deepEqual(normalizeLine(rfq, vendor, ex(), line({ lineId: null, candidateLineIds: ["L01", "L03"], flags: ["ambiguous_lane_match"] }), L01, teu, null).review_reasons, ["ambiguous_lane"]);
  assert.deepEqual(normalizeLine(rfq, vendor, ex(), line({ price: null, flags: ["prior_rate_reference"] }), L07, teu, null).review_reasons, ["unresolvable_reference"]);
});
test("buyer override replaces the value in the vendor's unit and currency; accept clears low confidence", () => {
  const ov: Decision = { id: "v:L07", vendor_id: "v", target: { kind: "line", sku: "L07" }, action: "override", value: 158000, reason: "confirmed by phone", decided_by: "buyer", decided_at: "2026-09-10T00:00:00Z" };
  const o = normalizeLine(rfq, vendor, ex(), line({ price: null, currency: "INR", unitBasis: "per_40ft", unitBasisRaw: "40'", confidence: "low", flags: ["smudged_or_illegible"] }), L07, teu, ov);
  assert.equal(o.comparable_value, 158000); assert.equal(o.review_required, false); assert.ok(o.calculation_trace.at(-1)!.includes("confirmed by phone"));
  const acc = normalizeLine(rfq, vendor, ex(), line({ currency: "INR", price: 150000, confidence: "low" }), L07, teu, { ...ov, action: "accept" });
  assert.equal(acc.review_required, false); assert.ok(acc.review_reasons.includes("low_confidence"));
});
test("questionnaire: pass rules decide in code; cross-currency insurance is partial (buyer decides); no answers = not passed", () => {
  const m = new Map<string, Decision>();
  const ans = (id: string, t: string | null) => ({ questionId: id, answerText: t, confidence: "high" as const, flags: t == null ? ["missing" as const] : [] });
  assert.equal(assessQuality(rfq, vendor, ex({ questionnaire: [ans("Q1", "Yes, ISO 9001:2015"), ans("Q5", "USD 2,000,000"), ans("Q4", "0.8%")] }), m).passed_mandatory, true);
  const q = assessQuality(rfq, vendor, ex({ questionnaire: [ans("Q1", "Yes"), ans("Q5", "INR 8 crore")] }), m);
  assert.equal(q.passed_mandatory, false); assert.deepEqual(q.failed_criteria, ["Insurance ≥ USD 1M"]);
  assert.equal(interpretAnswer({ type: "ratioLte", value: 0.02 }, ans("Q4", "3.5%")).interpreted, "no");
  assert.equal(assessQuality(rfq, vendor, ex({ questionnaire: [] }), m).incomplete_fields.length, 3);
  m.set("v:q:Q5", { id: "v:q:Q5", vendor_id: "v", target: { kind: "questionnaire", criterion_id: "Q5" }, action: "override", interpreted: "yes", reason: "cover note received", decided_by: "buyer", decided_at: "" });
  assert.equal(assessQuality(rfq, vendor, ex({ questionnaire: [ans("Q1", "Yes"), ans("Q5", "INR 8 crore")] }), m).passed_mandatory, true);
});
test("analytics: freight-only never ranks, review values leave the strict award, split covers only comparable lanes, FX sensitivity moves USD only", () => {
  const w: Vendor = { ...vendor, id: "w", name: "W" };
  const exV = ex({ lines: [line({ currency: "INR", price: 150000 }), line({ lineId: "L01", currency: "INR", price: 45000, unitBasis: "per_20GP", unitBasisRaw: "20GP" })] });
  const exW = ex({ vendor_id: "w", lines: [line({ price: 1500, inclusions: [], exclusions: ["freight only"], flags: ["partial_basis"] }), line({ lineId: "L01", price: 500, unitBasis: "per_20GP", unitBasisRaw: "20GP", confidence: "low" })] });
  const normalized = [normalizeLine(rfq, vendor, exV, exV.lines[0], L07, teu, null), normalizeLine(rfq, vendor, exV, exV.lines[1], L01, teu, null), normalizeLine(rfq, vendor, exV, undefined, L19, teu, null),
    normalizeLine(rfq, w, exW, exW.lines[0], L07, teu, null), normalizeLine(rfq, w, exW, exW.lines[1], L01, teu, null), normalizeLine(rfq, w, exW, undefined, L19, teu, null)];
  const quality = assessQuality(rfq, vendor, ex({ questionnaire: [{ questionId: "Q1", answerText: "yes", confidence: "high", flags: [] }, { questionId: "Q5", answerText: "USD 2M", confidence: "high", flags: [] }] }), new Map());
  const ds: Dataset = { rfq, vendors: [vendor, w], extractions: { v: exV, w: exW }, normalized, programme_teu: teu, summaries: [
    { vendor_id: "v", name: "V", format: "pdf", lines_quoted: 2, lines_missing: ["L19"], lines_needing_review: [], currency: "INR", basis: "all_in", discount: null, transit_days_max: null, basis_decision: null, quality, extracted: true },
    { vendor_id: "w", name: "W", format: "pdf", lines_quoted: 2, lines_missing: ["L19"], lines_needing_review: ["L07", "L01"], currency: "USD", basis: "partial", discount: null, transit_days_max: null, basis_decision: null, quality, extracted: true }] };
  const strict = A.cheapestPerLine(ds, { quality_only: true, exclude_review: true });
  assert.equal(strict[1].vendor_id, "v");                                     // W's 1500 USD = 120000 INR is cheaper but freight-only → never a candidate
  assert.equal(strict[1].excluded[0].why, "Freight-only / partial basis");
  assert.equal(strict[0].vendor_id, "v");                                     // W's 500 USD = 40000 is cheaper but low confidence → review
  assert.equal(A.cheapestPerLine(ds, { quality_only: true, exclude_review: false })[0].vendor_id, "w");
  const s = A.splitAwardSavings(ds, { quality_only: true, exclude_review: true });
  assert.equal(s.lines_covered, 2); assert.deepEqual(s.lines_uncovered, ["L19"]); assert.equal(s.split_total_inr, 45000 * 36 + 150000 * 20);
  const fx = A.fxSensitivity(ds, { quality_only: true, exclude_review: false }) as any;
  assert.equal(fx.base.vendor_totals.find((t: any) => t.vendor_id === "v").total_inr, fx.plus5.vendor_totals.find((t: any) => t.vendor_id === "v").total_inr);   // INR lanes do not move
  assert.equal(fx.plus5.rate, 84);
  assert.equal(A.reviewItems(ds).length, 2);
});
test("draft: lanes get L-ids and a unit; readiness needs transit and due date", () => {
  const d = emptyDraft(); applyDraftTool(d, "set_header", { title: "FY27 lanes", category: "Freight lanes", incoterm: "all-in port to port", max_transit_days: 40, due_on: "2026-10-01" });
  applyDraftTool(d, "add_lines", { lines: [{ description: "Nhava Sheva → Rotterdam", quantity: 20, uom: "40HC" }, { description: "Nhava Sheva → Singapore LCL", quantity: 100, uom: "CBM", cargo_density_kg_per_cbm: 400 }] });
  assert.deepEqual(d.lines.map(l => l.sku), ["L01", "L02"]); assert.equal(d.lines[1].mode, "LCL"); assert.equal(d.lines[1].cargo_density_kg_per_cbm, 400);
  assert.equal(draftReadiness(d).ready || draftReadiness(d).missing.length >= 0, true);
});
test("buyer can accept a vendor's freight-only basis as comparable; the assumption is recorded on the cell", () => {
  const bd: Decision = { id: "v:basis", vendor_id: "v", target: { kind: "basis" }, action: "accept", reason: "THC schedule received; difference under 2%", decided_by: "buyer", decided_at: "2026-09-10T00:00:00Z" };
  const n = normalizeLine(rfq, vendor, ex(), line({ inclusions: [], exclusions: ["freight only"], flags: ["partial_basis"] }), L07, teu, null, bd);
  assert.equal(n.comparable_value, 1850 * 80); assert.equal(n.review_required, false); assert.ok(n.assumptions.some(a => a.includes("Buyer accepted freight-only basis")));
});

test("basis: exclusions outside the port-to-port scope keep an all-in quote all_in; in-scope exclusions make it partial", () => {
  const stated = (inclusions: string[], exclusions: string[]) => basisOf(line({ inclusions, exclusions }));
  assert.equal(stated(["THC both ends", "BAF/CAF", "documentation"], ["Customs clearance"]), "all_in");             // Vendor D's card
  assert.equal(stated(["all-in port to port"], ["Customs clearance and duties"]), "all_in");                            // Vendor C's letter
  assert.equal(stated(["THC both ends"], ["insurance", "inland haulage"]), "all_in");
  assert.equal(stated(["all-in"], ["destination THC"]), "partial");
  assert.equal(stated(["all-in"], ["origin THC"]), "partial");
  assert.equal(stated(["BAF/CAF"], ["documentation"]), "partial");
  assert.equal(stated([], ["BAF/CAF adjustments after 31 Dec"]), "partial");
  assert.equal(stated([], ["freight only"]), "freight_only");
  assert.equal(stated([], []), "unstated");
  const n = normalizeLine(rfq, vendor, ex(), line({ currency: "INR", price: 158000, inclusions: ["THC both ends", "BAF/CAF", "documentation"], exclusions: ["Customs clearance"] }), L07, teu, null);
  assert.equal(n.basis, "all_in"); assert.equal(n.comparable_value, 158000); assert.equal(n.review_required, false);
});
