# QuoteIQ – freight lanes

Draft an RFx by conversation → issue it → read whatever suppliers send back (Excel, PDF, Word, a phone photo, an email) → one normalised comparison in INR per lane unit with every value traceable → ask questions in plain language → resolve what the system isn't sure about → a defensible award.
**LLM reads, code computes. AI recommends, the buyer approves.**

## Run it

```bash
npm install
cp .env.example .env.local        # LLM_API_KEY=<Gemini key>  (GEMINI_API_KEY / VITE_GEMINI_API_KEY also work)
npm run generate-data             # regenerates rfq.json, vendors.json, Vendor A/C/E documents, attachments, answer key (already committed)
npm run import-extraction -- ../quotekiller/spike/out/vendor-B.extracted.json ../quotekiller/spike/out/vendor-B.run.json
                                  # loads the validated Vendor B run (30/30) without calling the model
npm run extract                   # live extraction of the remaining suppliers -> data/extracted/*.json  (or: npx tsx scripts/extract_all.ts vendor-D)
npm run eval                      # scores extractions against the answer key (feeds the Trust page)
npm run dev                       # http://localhost:3000
```

Standalone scripts load `.env.local` / `.env` through Next.js's own loader (`scripts/env.ts`, `@next/env`), so the same file serves the app and the CLI. `npm test` runs the deterministic logic tests (no key). `npm run check` exercises parsing + normalisation + analytics end-to-end with answer-key-shaped data in a temp dir (never written to `data/extracted`).

## The scenario
30 lanes (18 FCL per 20GP/40HC, 8 LCL per CBM at a declared density, 4 air per kg chargeable), programme 434 TEU, five suppliers:

| Supplier | Format | The ugly edge |
|---|---|---|
| A · Bluewater Global | Excel, own layout, own lane codes (`NSA-JEA`) | INR, all-in, all 30, questionnaire on a second tab |
| B · Meridian Ocean Lines | PDF on letterhead | USD, freight only (buyer can accept the basis as comparable), 4% rebate above 200 TEU only in a **page-2 footnote** – captured as a condition, applied by code at programme level, never by the model |
| C · CorriGlobe | Word, commercials in prose | INR, all-in, quotes 27/30 and silently skips 3, insurance stated in INR against a USD rule |
| D · SeaCrest | Phone photo of a rate card | INR all-in, per 20'/40' (unit variants), LCL **per w/m**, four smudged cells, two lanes absent |
| E · Harbourline | Plain email | USD freight only, "the Jebel Ali 20s" (ambiguous between two lanes), "Singapore same as last year +3%", LCL passed |

## The flow, screen by screen

| Screen | What happens | Where |
|---|---|---|
| **Draft RFx** | Buyer talks; the co-pilot edits the RFQ only through tools (lanes need origin, destination, unit, and density for LCL). "Issue" writes one `.eml` per supplier to `data/outbox/` (SMTP stubbed). | `lib/draft.ts`, `/draft` |
| **Supplier responses** | Each file goes to the model as it arrived (PDF/photo inline, Excel/Word/email as text) and comes back as a structured record: rate as written, currency and unit as stated, inclusions/exclusions, footnotes as **conditions**, questionnaire answers, evidence with page/region, confidence label, typed flags. Nothing is converted here. | `lib/extract.ts`, `lib/prompts/extract.md` |
| **Supplier page** | Layer 2 (what they sent) beside Layer 3 (what was read). Every flagged value has **Accept / Override / Reject** with a mandatory reason; a freight-only basis can be **accepted as comparable** at vendor level, recorded as an assumption on every lane. | `/responses/[vendor]`, `lib/decisions.ts` |
| **Comparison** | INR per RFQ unit: unit variants and w/m at declared density → USD at the frozen rate → programme rebate where the TEU threshold is met. Freight-only quotes are shown but never compared. Amber = needs a person. Hover for the original, evidence, confidence and every assumption. Export to Excel (8 sheets incl. Uncertainties and Provenance & assumptions). | `lib/normalize.ts`, `/api/export` |
| **AI analyst** | Function-calling loop over `lib/analytics.ts` – the same functions that drive the award. Cheapest per lane, questionnaire-restricted split, single vs split totals, FX ±5%, review items ("least sure" = exactly the amber cells), what-ifs, charts, CSV. The model never does arithmetic. | `lib/analyst.ts` |
| **Award** | Strict recommendation (questionnaire-passing, comparable, no unresolved review) plus counterfactuals: "if review items confirmed" and "if questionnaire failures ignored". LLM memo from the computed numbers only. | `buildRecommendation` |
| **Trust & audit** | Extraction score vs answer key, confidence distribution, every assumption, full decision log. | `/trust` |

## LLM provider
All model calls go through `lib/llm/index.ts`. Default is **Gemini** via `@google/genai` (`lib/llm/gemini.ts`: JSON-schema structured output for extraction – the path validated on Vendor B – and function calling for the analyst). Anthropic remains selectable with `LLM_PROVIDER=anthropic`. Schema, prompts, tools and all maths are identical across providers.

## Left out on purpose
Real email and supplier portal (stubbed); live FX (frozen rate on the RFQ, recorded as an assumption); OCR fallback (the vision model reads and flags what it can't); a code-execution tool for the analyst (deterministic analytics instead); per-lane award overrides (decisions on values and basis cover the need). See NOTE.md.
