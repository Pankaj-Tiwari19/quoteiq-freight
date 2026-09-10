// Exercises parsing + normalization + analytics WITHOUT the LLM, by turning the answer key into Extraction-shaped JSON in a temp dir.
// Never writes to data/extracted. This is test scaffolding, not extraction.
import fs from "fs"; import path from "path"; import os from "os";
import { parseVendorDoc } from "../lib/parse";
import { loadVendors, buildDataset } from "../lib/normalize";
import * as A from "../lib/analytics";
(async () => {
  for (const v of loadVendors()) { const d = await parseVendorDoc(v); console.log(`parse ${v.id} (${v.response_format}) -> ${d.kind}${d.kind === "text" ? ` ${d.text.length} chars` : ` ${d.media_type}`}`); }
  const truth = JSON.parse(fs.readFileSync("data/ground_truth.json", "utf8")).vendors;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiq-")); fs.mkdirSync(path.join(tmp, "data", "extracted"), { recursive: true });
  for (const f of ["rfq.json", "vendors.json"]) fs.copyFileSync(path.join("data", f), path.join(tmp, "data", f));
  const unitRaw: Record<string, string> = { per_20GP: "20' GP", per_40HC: "40' HC", per_20ft: "20'", per_40ft: "40'", per_CBM: "per CBM", per_wm: "per w/m", per_kg: "per kg" };
  for (const [vid, t] of Object.entries<any>(truth)) {
    const excl = t.basis === "freight_only" ? ["freight only"] : t.basis === "partial" ? ["destination THC extra"] : [];
    const lines = Object.entries<any>(t.cells).map(([id, c]) => ({ lineId: c.expect === "ambiguous_lane_match" ? null : id, candidateLineIds: c.candidates, vendorLaneLabel: id, matchedLineConfidence: "high", price: c.expect === "value" ? c.price : null, currency: c.currency ?? t.currency, unitBasis: c.unitBasis ?? "unknown", unitBasisRaw: unitRaw[c.unitBasis] ?? "", inclusions: t.basis === "all_in" ? ["all-in"] : [], exclusions: excl,
      confidence: c.expect === "low_confidence" ? "low" : "high", evidence: { file: t.file, excerpt: "synthetic" }, flags: c.expect === "missing" ? ["missing"] : c.expect === "low_confidence" ? ["smudged_or_illegible"] : c.expect === "ambiguous_lane_match" ? ["ambiguous_lane_match"] : c.expect === "prior_rate_reference" ? ["prior_rate_reference"] : t.basis !== "all_in" ? ["partial_basis"] : [] }));
    const conditions = (t.conditions ?? []).map((c: any) => ({ kind: "volume_discount", text: `${c.pct}% rebate above ${c.thresholdTeu} TEU`, evidence: { file: t.file, excerpt: "synthetic", page: c.page }, appliesTo: "all", confidence: "high", discountPct: c.pct, thresholdQty: c.thresholdTeu, thresholdUnit: "TEU", thresholdScope: "programme" }));
    fs.writeFileSync(path.join(tmp, "data", "extracted", vid + ".json"), JSON.stringify({ vendor_id: vid, source_file: t.file, extracted_at: "synthetic", model: "answer-key", lines, conditions, questionnaire: Object.entries<string>(t.questionnaire ?? {}).map(([questionId, v]) => ({ questionId, answerText: v === "unanswered" ? null : v === "yes" ? "Yes" : v === "no" ? "No" : "on request", confidence: "high", flags: v === "unanswered" ? ["missing"] : [] })), docSummaries: [], readingNotes: "synthetic" }));
  }
  process.chdir(tmp);
  const ds = buildDataset();
  for (const s of ds.summaries) console.log(`${s.name.padEnd(30)} quoted ${s.lines_quoted}/30 missing ${s.lines_missing.length} review ${s.lines_needing_review.length} basis ${s.basis} discount ${s.discount ? `${s.discount.pct}% ${s.discount.applied ? "applied" : "not applied"}` : "-"} questionnaire ${s.quality.passed_mandatory ? "PASS" : "not passed (" + s.quality.failed_criteria.join("; ") + ")"}`);
  const b = ds.normalized.find(n => n.vendor_id === "vendor-B" && n.sku === "L07")!; console.log("Vendor B L07:", b.normalized_value, "comparable:", b.comparable_value, b.review_reasons, b.calculation_trace);
  const d = ds.normalized.find(n => n.vendor_id === "vendor-D" && n.sku === "L19")!; console.log("Vendor D L19 (smudged w/m):", d.normalized_value, d.review_reasons);
  const d2 = ds.normalized.find(n => n.vendor_id === "vendor-D" && n.sku === "L02")!; console.log("Vendor D L02 (40'):", d2.comparable_value, d2.assumptions);
  const e = ds.normalized.find(n => n.vendor_id === "vendor-E" && n.sku === "L01")!; console.log("Vendor E L01:", e.review_reasons, e.review_note);
  const s = A.splitAwardSavings(ds, { quality_only: false, exclude_review: true });
  console.log("split (comparable, no review):", s.split_total_inr, "best single:", s.best_single_vendor, "uncovered:", s.lines_uncovered, "alloc:", Object.fromEntries(Object.entries(s.allocation).map(([k, v]) => [k, v.lines.length])));
  console.log("strict (questionnaire-passing):", A.splitAwardSavings(ds, { quality_only: true, exclude_review: true }).split_total_inr, "risks:", A.risks(ds).length, "review items:", A.reviewItems(ds).length);
  console.log("fx:", JSON.stringify(A.fxSensitivity(ds, { exclude_review: true })).slice(0, 300));
})().catch(e => { console.error(e); process.exit(1); });
