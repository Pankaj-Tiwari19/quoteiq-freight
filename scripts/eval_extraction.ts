// Scores extractions in data/extracted against the answer key data/ground_truth.json (the answer key is never read by the app).
//   npm run eval
import fs from "fs";
import { loadExtractions } from "../lib/normalize";
const truth = JSON.parse(fs.readFileSync("data/ground_truth.json", "utf8")).vendors;
const ex = loadExtractions();
const fam = (u: string) => String(u ?? "").replace(/^per_/, "").replace(/^(20|40).*/, "$1");
let tot = 0, ok = 0, ftot = 0, fok = 0; let model: string | null = null;
for (const [vid, t] of Object.entries<any>(truth)) {
  const e = ex[vid]; if (!e) { console.log(`${vid}: not extracted`); continue; }
  model ??= e.model;
  const got = new Map(e.lines.filter(l => l.lineId).map(l => [l.lineId!.toUpperCase(), l]));
  let vOk = 0, vTot = 0, vfOk = 0, vfTot = 0; const misses: string[] = [];
  for (const [id, tc] of Object.entries<any>(t.cells)) {
    const g = got.get(id) ?? e.lines.find(l => l.lineId === null && l.candidateLineIds?.includes(id));
    if (tc.expect === "value") { vTot++; const hit = g && g.price === tc.price && fam(g.unitBasis) === fam(tc.unitBasis) && g.currency === tc.currency; if (hit) vOk++; else misses.push(`${id}: want ${tc.price} ${tc.unitBasis} ${tc.currency}, got ${g ? `${g.price} ${g.unitBasis} ${g.currency} conf=${g.confidence}` : "nothing"}`); }
    else { vfTot++; const flagged = g ? (tc.expect === "missing" ? g.flags.includes("missing") && g.price == null : tc.expect === "low_confidence" ? (g.confidence === "low" || g.flags.includes("smudged_or_illegible")) && g.price == null : tc.expect === "ambiguous_lane_match" ? g.lineId === null && g.flags.includes("ambiguous_lane_match") : g.flags.includes("prior_rate_reference") && g.price == null) : tc.expect === "missing";
      if (flagged) vfOk++; else misses.push(`${id}: expected ${tc.expect}, got ${g ? `${g.price} flags=${g.flags.join(",")} conf=${g.confidence}` : "no entry"}`); }
  }
  const disc = t.conditions?.find((c: any) => c.kind === "volume_discount");
  let discNote = "";
  if (disc) { const c = e.conditions.find(c => c.kind === "volume_discount"); const applied = Object.entries<any>(t.cells).filter(([id, tc]) => tc.price && got.get(id)?.price != null && Math.abs((got.get(id)!.price as number) - tc.price * (1 - disc.pct / 100)) < 0.01).length; discNote = ` | discount condition ${c ? `captured (page ${c.evidence?.page ?? "?"}, ${c.discountPct}% above ${c.thresholdQty} ${c.thresholdUnit})` : "MISSING"} | silently applied on ${applied} lines${applied ? " <<< FAIL" : ""}`; }
  console.log(`\n${vid}: ${vOk}/${vTot} rates exact | flags ${vfOk}/${vfTot}${discNote} | model ${e.model}`);
  misses.forEach(m => console.log("   " + m));
  tot += vTot; ok += vOk; ftot += vfTot; fok += vfOk;
}
if (tot) console.log(`\nOverall: rates ${ok}/${tot} (${((ok / tot) * 100).toFixed(1)}%) · flags ${fok}/${ftot}`);
fs.mkdirSync("data/eval", { recursive: true });
fs.writeFileSync("data/eval/latest.json", JSON.stringify({ run_at: new Date().toISOString(), model, lines: { ok, total: tot }, flags: { ok: fok, total: ftot } }, null, 2));
