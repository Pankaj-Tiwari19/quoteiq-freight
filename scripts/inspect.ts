// Prints the normalised state of one supplier from the SAME source the pages use (data/extracted/*.json via buildDataset()),
// so CLI and browser can be compared like-for-like. `npm run check` does NOT do this – it normalises answer-key-shaped
// synthetic data in a temp dir. No model call, no key.
//   npm run inspect -- vendor-C
import { buildDataset, isInScopeExclusion, basisOf } from "../lib/normalize";
import { basisLabel } from "../lib/format";
const id = process.argv[2] ?? "vendor-C";
const ds = buildDataset();
const s = ds.summaries.find(x => x.vendor_id === id); const ex = ds.extractions[id];
if (!s || !ex) { console.log(`${id}: not extracted (no data/extracted/${id}.json)`); process.exit(0); }
console.log(`${s.name}: ${s.lines_quoted}/${ds.rfq.lines.length} · basis ${basisLabel[s.basis]} · extracted ${ex.extracted_at} · ${ex.model}`);
const counts: Record<string, number> = {}; for (const n of ds.normalized.filter(n => n.vendor_id === id && n.original_value != null)) counts[n.basis] = (counts[n.basis] ?? 0) + 1;
console.log("per-lane basis:", counts);
const l = ex.lines.find(l => l.price != null)!;
console.log(`first priced lane ${l.lineId}: inclusions=${JSON.stringify(l.inclusions)} exclusions=${JSON.stringify(l.exclusions)} flags=${JSON.stringify(l.flags)} → basisOf = ${basisOf(l)}`);
const fo = ex.lines.filter(l => /freight only/i.test([...l.inclusions, ...l.exclusions].join(" | ")));
if (fo.length) console.log(`"freight only" literally appears in ${fo.length} lane(s), e.g. ${l.lineId}: ${JSON.stringify([...fo[0].inclusions, ...fo[0].exclusions].filter(t => /freight only/i.test(t)))}`);
console.log("in-scope exclusions found:", [...new Set(ex.lines.flatMap(l => l.exclusions.filter(isInScopeExclusion)))]);
console.log("conditions:", ex.conditions.map(c => `${c.kind}: ${c.text.slice(0, 100)}`));
