// Runs the real LLM extraction for every supplier document and caches results in data/extracted/.
// Usage: npm run extract            (all vendors)
//        npx tsx scripts/extract_all.ts vendor-D   (one supplier)
import "./env";
import { loadRfq, loadVendors } from "../lib/normalize";
import { extractVendor } from "../lib/extract";
(async () => {
  const only = process.argv[2];
  const rfq = loadRfq();
  const failed: string[] = [];
  for (const v of loadVendors()) {
    if (only && v.id !== only) continue;
    process.stdout.write(`Extracting ${v.name} (${v.response_format})... `);
    try {
      const ex = await extractVendor(rfq, v);
      console.log(`${ex.lines.length} lanes (${ex.lines.filter(l => l.price != null).length} priced, ${ex.lines.filter(l => l.confidence === "low").length} low confidence), ${ex.conditions.length} conditions, ${ex.questionnaire.filter(q => q.answerText != null).length} questionnaire answers`);
    } catch (e: any) {
      failed.push(v.id);
      console.log(`FAILED\n   ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`);
    }
  }
  if (failed.length) { console.error(`\n${failed.length} vendor(s) NOT extracted: ${failed.join(", ")}. Re-run with: npx tsx scripts/extract_all.ts <vendor_id>`); process.exit(1); }
  console.log("\nAll requested vendors extracted.");
})().catch(e => { console.error(e); process.exit(1); });
