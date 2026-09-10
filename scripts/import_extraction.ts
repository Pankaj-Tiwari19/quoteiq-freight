// Imports an extraction produced elsewhere (e.g. the validated CLI run: spike/out/vendor-B.extracted.json + .run.json,
// or a seed file {run, result}) into data/extracted/<vendor>.json in this app's shape. No model call.
//   npm run import-extraction -- /path/to/vendor-B.extracted.json [/path/to/vendor-B.run.json]
import fs from "fs"; import path from "path";
import { upgradeExtraction, loadVendors } from "../lib/normalize";
const [src, runPath] = process.argv.slice(2);
if (!src) { console.error("usage: npm run import-extraction -- <extracted.json> [run.json]"); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(src, "utf8"));
const run = runPath ? JSON.parse(fs.readFileSync(runPath, "utf8")) : raw.run;
const ex = upgradeExtraction(run ? { run, result: raw.result ?? raw } : raw);
const v = loadVendors().find(x => x.id === ex.vendor_id);
if (!v) { console.error(`Unknown vendor_id ${ex.vendor_id}; expected one of ${loadVendors().map(x => x.id).join(", ")}`); process.exit(1); }
ex.source_file = v.file;
if (run?.model) ex.model = `gemini/${run.model} · prompt v${run.promptVersion ?? "?"} (imported)`;
const dir = path.join(process.cwd(), "data", "extracted"); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${ex.vendor_id}.json`), JSON.stringify(ex, null, 2));
console.log(`imported ${ex.vendor_id}: ${ex.lines.length} lines (${ex.lines.filter(l => l.price != null).length} priced, ${ex.lines.filter(l => l.confidence === "low").length} low confidence), ${ex.conditions.length} conditions, model ${ex.model}, extracted ${ex.extracted_at}`);
