import * as A from "./analytics";
import type { Dataset } from "./types";
import { getLlm, type LlmTool } from "./llm";

const TOOLS: LlmTool[] = [
  { name: "cheapest_per_line", description: "Cheapest eligible supplier for every lane in INR per RFQ unit (20GP/40HC/CBM/kg), computed by code from comparable all-in cells only; freight-only and partial quotes are listed under `excluded` with the reason and are never ranked. Options: quality_only keeps only suppliers passing mandatory questionnaire criteria; exclude_review ignores values flagged for human review; basis 'converted' would include non-comparable numbers (only if the buyer explicitly asks).", input_schema: { type: "object", properties: { quality_only: { type: "boolean" }, exclude_review: { type: "boolean" }, basis: { type: "string", enum: ["comparable", "converted"] } } } },
  { name: "split_award_savings", description: "Annual total of a lane-by-lane split award vs the best complete single-supplier award, with allocation per supplier and the lanes no eligible supplier covers. Same options as cheapest_per_line.", input_schema: { type: "object", properties: { quality_only: { type: "boolean" }, exclude_review: { type: "boolean" }, basis: { type: "string", enum: ["comparable", "converted"] } } } },
  { name: "vendor_totals", description: "Each supplier's annual total (INR) over the lanes it priced comparably, whether it covers every lane, how many values are under review, and which lanes are not comparable.", input_schema: { type: "object", properties: { quality_only: { type: "boolean" }, exclude_review: { type: "boolean" } } } },
  { name: "fx_sensitivity", description: "Comparable totals per supplier and the split total at USD→INR −5% / base / +5%. INR-quoted lanes do not move. Computed by code.", input_schema: { type: "object", properties: { quality_only: { type: "boolean" }, exclude_review: { type: "boolean" } } } },
  { name: "incomplete_vendors", description: "Suppliers with missing lanes, unusable rates, or blank questionnaire fields.", input_schema: { type: "object", properties: {} } },
  { name: "low_confidence_values", description: "All extracted values the extractor labelled low (or below a numeric threshold, default 0.8), with evidence and the reason.", input_schema: { type: "object", properties: { threshold: { type: "number" } } } },
  { name: "review_items", description: "Every value flagged for human review with the reason (illegible, low confidence, freight-only basis, unit mismatch, needs FX/density, prior-rate reference, ambiguous lane). This is exactly the set of amber cells in the comparison – use it for 'least sure' questions.", input_schema: { type: "object", properties: {} } },
  { name: "quality_status", description: "Questionnaire result per supplier: pass/fail on mandatory criteria (ISO 9001, insurance ≥ USD 1M), decided by the RFQ rules in code, with the raw answers and evidence.", input_schema: { type: "object", properties: {} } },
  { name: "vendor_summaries", description: "Per-supplier summary: format, currency, basis (all-in / freight only), discount and whether it applied, transit, coverage, questionnaire status, document conditions.", input_schema: { type: "object", properties: {} } },
  { name: "line_detail", description: "All suppliers' quotes for one lane (id like L07) with the original value, basis, assumptions, normalization trace and evidence.", input_schema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } },
  { name: "risk_register", description: "Deterministic list of risks (questionnaire failures, missing lanes, non-comparable freight-only quotes, transit time, FX, discounts, assumptions, values under review).", input_schema: { type: "object", properties: {} } },
  { name: "decisions_log", description: "Every decision the buyer has recorded on flagged values or questionnaire answers (accept/override/reject/clarify) with reasons.", input_schema: { type: "object", properties: {} } },
  { name: "what_if_accept", description: "Which award lanes would change, and the saving, if all of one supplier's review items were accepted as read (basis mismatches cannot be accepted away).", input_schema: { type: "object", required: ["vendor_id"], properties: { vendor_id: { type: "string" } } } },
  { name: "render_chart", description: "Show a chart to the buyer. Call this AFTER getting data from other tools; pass the numbers you want plotted. Use for comparisons across suppliers or lanes. Returns ok; the chart is displayed automatically.", input_schema: { type: "object", required: ["type", "title", "labels", "series"], properties: { type: { type: "string", enum: ["bar", "line"] }, title: { type: "string" }, labels: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", required: ["name", "values"], properties: { name: { type: "string" }, values: { type: "array", items: { type: ["number", "null"] } } } } }, y_label: { type: "string" } } } },
  { name: "export_table", description: "Offer the buyer a downloadable CSV. Call AFTER getting data from other tools; pass the rows. Returns ok; the download is shown automatically.", input_schema: { type: "object", required: ["filename", "columns", "rows"], properties: { filename: { type: "string" }, columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: ["string", "number", "null"] } } } } } },
];

export interface Artifact { kind: "chart" | "csv"; payload: any }
function runTool(ds: Dataset, name: string, input: any, artifacts: Artifact[]) {
  switch (name) {
    case "decisions_log": return A.decisionsLog(ds);
    case "what_if_accept": return A.whatIfAccept(ds, input.vendor_id);
    case "render_chart": artifacts.push({ kind: "chart", payload: input }); return { ok: true, shown: true };
    case "export_table": artifacts.push({ kind: "csv", payload: input }); return { ok: true, shown: true };
    case "cheapest_per_line": return A.cheapestPerLine(ds, input);
    case "split_award_savings": return A.splitAwardSavings(ds, input);
    case "vendor_totals": return A.vendorTotals(ds, input);
    case "fx_sensitivity": return A.fxSensitivity(ds, input);
    case "incomplete_vendors": return A.incompleteVendors(ds);
    case "low_confidence_values": return A.lowConfidence(ds, input?.threshold ?? 0.8);
    case "review_items": return A.reviewItems(ds);
    case "quality_status": return A.qualityStatus(ds);
    case "vendor_summaries": return A.vendorSummaries(ds);
    case "line_detail": return A.lineDetail(ds, String(input.sku ?? "").toUpperCase().replace(/^L-?(\d{1,2})$/, (_m, n) => `L${n.padStart(2, "0")}`));
    case "risk_register": return A.risks(ds);
    default: return { error: "unknown tool" };
  }
}

export interface AnalystTurn { role: "user" | "assistant"; content: string }
export interface AnalystResult { answer: string; tool_calls: { name: string; input: any; rows: number }[]; artifacts: Artifact[] }

export async function askAnalyst(ds: Dataset, history: AnalystTurn[], question: string): Promise<AnalystResult> {
  const llm = await getLlm();
  const vendorList = ds.vendors.map(v => `${v.id} = ${v.name}`).join(", ");
  const system = `You are QuoteIQ's freight procurement analyst for ${ds.rfq.rfq_id} (${ds.rfq.title}, ${ds.rfq.lines.length} lanes: FCL per 20GP/40HC, LCL per CBM, air per kg chargeable; programme ${ds.programme_teu} TEU; buyer currency INR, USD at ${ds.rfq.fx.USD_INR ?? "no rate entered"}). Suppliers: ${vendorList}.
You answer ONLY by calling tools against the normalized dataset and reporting what they return. You never add, subtract, average or convert numbers yourself; every figure you state is copied from a tool result. Money is INR; use ₹ and Indian formatting.
Comparable means comparable: tools already exclude freight-only/partial quotes, illegible cells, unit mismatches and missing lanes from rankings and totals. Always name those exclusions (lane ids and supplier names) and any assumptions (FX, unit variants, density, programme rebate) the winning numbers carry. If a supplier is not extracted, say so rather than inferring. For "least sure" questions use review_items and low_confidence_values. Questionnaire eligibility comes from quality_status, never from a supplier's name.
Be concise: lead with the answer, then a compact markdown table or list, then caveats. Use supplier names, not ids. When the buyer asks to see, plot, chart or compare visually, call render_chart with the numbers from tools. When they ask to export or download, call export_table. Remember: AI recommends, the buyer approves.`;
  const artifacts: Artifact[] = [];
  const r = await llm.chatWithTools({ system, history, question, tools: TOOLS, runTool: (name, input) => runTool(ds, name, input, artifacts), maxIterations: 8, maxTokens: 3000 });
  return { ...r, artifacts };
}

/** Award recommendation = deterministic strategy + optional LLM narrative. */
export function buildRecommendation(ds: Dataset) {
  const strict = A.splitAwardSavings(ds, { quality_only: true, exclude_review: true });   // what we can defend today
  const withReview = A.splitAwardSavings(ds, { quality_only: true, exclude_review: false }); // if review items are confirmed
  const unconstrained = A.splitAwardSavings(ds, { quality_only: false, exclude_review: false });
  const perLine = A.cheapestPerLine(ds, { quality_only: true, exclude_review: true });
  const exceptions = [
    ...strict.lines_uncovered.map(sku => ({ sku, type: "no_defensible_price", detail: A.lineDetail(ds, sku) })),
  ];
  return { strict, withReview, unconstrained, perLine, exceptions, risks: A.risks(ds), quality: A.qualityStatus(ds) };
}

export async function narrateRecommendation(ds: Dataset) {
  const rec = buildRecommendation(ds);
  const llm = await getLlm();
  const memo = await llm.complete({ maxTokens: 1500,
    system: "You are QuoteIQ. Write a short freight award recommendation memo (max ~220 words, plain prose with a few short bullets) for a procurement buyer. Use only the numbers given; never compute new ones. Name lanes by id and suppliers by name. State clearly that this is an AI recommendation requiring buyer approval, name the assumptions the figures rest on (FX rate, programme rebate, unit variants), and list the exact items the buyer must resolve before award.",
    prompt: `RFQ ${ds.rfq.rfq_id} (freight lanes, annual INR, USD at ${ds.rfq.fx.USD_INR}). Data:\n${JSON.stringify({ supplier_names: Object.fromEntries(ds.vendors.map(v => [v.id, v.name])), strict: { ...rec.strict, vendor_totals: undefined }, if_review_confirmed: { split_total_inr: rec.withReview.split_total_inr, savings_inr: rec.withReview.savings_inr, review_lines: rec.withReview.lines_in_split_needing_review }, unconstrained_would_save_extra_inr: rec.unconstrained.savings_inr, risks: rec.risks, quality: rec.quality.map(q => ({ name: q.name, passed: q.passed_mandatory, failed: q.failed, needs_review: q.needs_review })), buyer_decisions: A.decisionsLog(ds) })}` });
  return { ...rec, memo };
}
