// Buyer decisions on flagged values. Stored separately from extractions so the model output is never edited:
// Layer 3 = extraction (what the model read) + decisions (what the buyer resolved), and both are visible.
import fs from "fs";
import path from "path";
import type { Decision } from "./types";

const FILE = () => path.join(process.cwd(), "data", "decisions.json");

export function loadDecisions(): Decision[] { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")).decisions ?? []; } catch { return []; } }
export function saveDecisions(ds: Decision[]) { fs.writeFileSync(FILE(), JSON.stringify({ decisions: ds }, null, 2)); }
export const lineDecisionId = (vendor_id: string, sku: string) => `${vendor_id}:${sku}`;
export const qDecisionId = (vendor_id: string, criterion_id: string) => `${vendor_id}:q:${criterion_id}`;
export const basisDecisionId = (vendor_id: string) => `${vendor_id}:basis`;

export function decisionMap(ds = loadDecisions()) { return new Map(ds.map(d => [d.id, d])); }

export function recordDecision(input: Omit<Decision, "id" | "decided_at"> & { decided_at?: string }): Decision {
  const id = input.target.kind === "line" ? lineDecisionId(input.vendor_id, input.target.sku) : input.target.kind === "basis" ? basisDecisionId(input.vendor_id) : qDecisionId(input.vendor_id, input.target.criterion_id);
  const d: Decision = { ...input, id, decided_at: input.decided_at ?? new Date().toISOString() };
  if (!d.reason?.trim()) throw new Error("A reason is required for every decision.");
  if (d.action === "override" && d.target.kind === "line" && (d.value == null || isNaN(Number(d.value)))) throw new Error("Override needs a numeric value.");
  if (d.action === "override" && d.target.kind === "questionnaire" && !d.interpreted) throw new Error("Override needs an interpretation.");
  const all = loadDecisions().filter(x => x.id !== id); all.push(d); saveDecisions(all);
  return d;
}
export function removeDecision(id: string) { saveDecisions(loadDecisions().filter(x => x.id !== id)); }
