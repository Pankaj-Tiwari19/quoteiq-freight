// Generates the freight dataset: data/rfq.json, data/vendors.json, Vendor A (xlsx), C (docx), E (eml), attachments,
// and data/ground_truth.json (answer key, used only by `npm run eval` and `npm run check`, never by the app).
// Vendor B (PDF with page-2 rebate footnote) and Vendor D (photographed rate card) are pre-built fixtures in data/vendor_docs.
//   npm run generate-data
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { LANES, programmeTeu } from "./data/lanes";
import { VENDOR_B, VENDOR_D } from "./data/quotes-bd";

(async () => {
const DATA = path.join(process.cwd(), "data"); const DOCS = path.join(DATA, "vendor_docs");
fs.mkdirSync(DOCS, { recursive: true });
const lane = (id: string) => LANES.find(l => l.lineId === id)!;
const label = (id: string) => { const l = lane(id); return `${l.originName} – ${l.destinationName}${l.direction === "import" ? " (import)" : ""}`; };
const unitWord = (id: string) => ({ "20GP": "20' GP", "40HC": "40' HC", CBM: "per CBM", KG: "per kg chargeable" } as Record<string, string>)[lane(id).stdUnit];

// ---------- Layer 1: RFQ ----------
const questionnaire = [
  { id: "Q1", label: "ISO 9001 certified", mandatory: true, question: "Do you hold a valid ISO 9001 certificate? Attach a copy.", pass_rule: { type: "boolean", pass: true } },
  { id: "Q2", label: "IATA / FIATA member", mandatory: false, question: "Are you an IATA and/or FIATA member? State membership numbers.", pass_rule: { type: "boolean", pass: true } },
  { id: "Q3", label: "Own CFS at Nhava Sheva", mandatory: false, question: "Do you operate your own CFS at Nhava Sheva, or use a third party? Name it.", pass_rule: { type: "manual" } },
  { id: "Q4", label: "Claims ratio ≤ 2%", mandatory: false, question: "What was your cargo claims ratio (claims / shipments) in the last financial year?", pass_rule: { type: "ratioLte", value: 0.02 } },
  { id: "Q5", label: "Marine liability cover ≥ USD 1M", mandatory: true, question: "What is your marine liability insurance cover? State the amount and currency and attach the certificate.", pass_rule: { type: "amountGte", value: 1000000, currency: "USD" } },
  { id: "Q6", label: "Escalation SLA stated", mandatory: false, question: "What is your escalation SLA for a shipment exception (hours to named manager)?", pass_rule: { type: "manual" } },
  { id: "Q7", label: "ESG / emissions reporting", mandatory: false, question: "Do you publish ESG / emissions reporting per shipment?", pass_rule: { type: "boolean", pass: true } },
  { id: "Q8", label: "Two references > 500 TEU", mandatory: false, question: "Provide two references from Indian exporters with annual volume above 500 TEU.", pass_rule: { type: "manual" } },
];
const rfq = {
  rfq_id: "RFX-2026-09-FRT", title: "Annual freight lanes FY27 – FCL / LCL / Air", category: "Freight lanes (ocean FCL/LCL, air)", buyer: "Aerchain Procurement, Mumbai", currency: "INR",
  issued_on: "2026-09-10", due_on: "2026-09-24", status: "Responses received – under evaluation",
  incoterm: "Rates requested all-in, port-to-port, per lane in the stated unit (20GP / 40HC / per CBM at declared density / per kg chargeable). USD accepted; evaluated at the frozen rate below.",
  max_transit_days: 40,
  fx: { USD_INR: 84.1, as_of: "2026-09-10", source: "RBI reference rate (frozen for evaluation)" },
  quality_questionnaire: questionnaire,
  lines: LANES.map(l => ({ sku: l.lineId, description: `${l.originName} → ${l.destinationName}${l.direction === "import" ? " (import)" : ""}`, quantity: l.annualQty, uom: l.stdUnit, mode: l.mode, origin: l.origin, origin_name: l.originName, destination: l.destination, destination_name: l.destinationName, direction: l.direction, ...(l.cargoDensityKgPerCbm ? { cargo_density_kg_per_cbm: l.cargoDensityKgPerCbm } : {}) })),
};
fs.writeFileSync(path.join(DATA, "rfq.json"), JSON.stringify(rfq, null, 2));

// ---------- Layer 2: vendors ----------
const vendors = [
  { id: "vendor-A", name: "Bluewater Global Logistics", location: "Nhava Sheva, Maharashtra", response_format: "xlsx", file: "vendor-A-excel-ignores-template.xlsx", received_on: "2026-09-15", email: "tenders@bluewater.example", attachments: ["vendor-A-iso9001-certificate.txt"], questionnaire_note: "Questionnaire answered on a second sheet tab of the workbook." },
  { id: "vendor-B", name: "Meridian Ocean Lines Pvt. Ltd.", location: "Ballard Estate, Mumbai", response_format: "pdf", file: "vendor-B-pdf-footnote-discount.pdf", received_on: "2026-09-12", email: "commercial@meridianocean.example", questionnaire_note: "Letter says questionnaire and certificates follow under separate cover; nothing has arrived." },
  { id: "vendor-C", name: "CorriGlobe Freight Services", location: "Andheri East, Mumbai", response_format: "docx", file: "vendor-C-word-prose.docx", received_on: "2026-09-14", email: "bids@corriglobe.example", attachments: ["vendor-C-insurance-cover-note.txt"], questionnaire_note: "Questionnaire answered in prose paragraphs at the end of the document." },
  { id: "vendor-D", name: "SeaCrest Freight & Logistics", location: "Uran, Maharashtra", response_format: "image", file: "vendor-D-photo-rate-card.png", received_on: "2026-09-16", email: "seacrest.rates@example.com", questionnaire_note: "Photographed rate card only; no questionnaire." },
  { id: "vendor-E", name: "Harbourline Shipping & Air", location: "Mundra, Gujarat", response_format: "email", file: "vendor-E-email-only.eml", received_on: "2026-09-19", email: "ops@harbourline.example", attachments: ["vendor-E-reference-letter.txt"], questionnaire_note: "Partial answers inline in the email body." },
];
fs.writeFileSync(path.join(DATA, "vendors.json"), JSON.stringify({ vendors }, null, 2));

// ---------- Vendor A: nice Excel, own layout, own lane codes, INR, all-in, all 30 ----------
const CODE: Record<string, string> = { INNSA: "NSA", INMUN: "MUN", INMAA: "MAA", INBOM: "BOM", AEJEA: "JEA", SGSIN: "SIN", NLRTM: "RTM", USLAX: "LAX", MYPKG: "PKG", DEHAM: "HAM", GBFXT: "FXT", LKCMB: "CMB", CNSHA: "SHA", KRPUS: "PUS", AEDXB: "DXB", NLAMS: "AMS", USORD: "ORD" };
const A_PRICES: Record<string, number> = { L01: 43800, L02: 66500, L03: 41900, L04: 64200, L05: 36200, L06: 53900, L07: 155000, L08: 152500, L09: 222000, L10: 31800, L11: 40200, L12: 159500, L13: 163000, L14: 21500, L15: 92500, L16: 54800, L17: 88900, L18: 33600, L19: 1880, L20: 2380, L21: 2210, L22: 3820, L23: 5250, L24: 3700, L25: 2540, L26: 2190, L27: 121, L28: 163, L29: 239, L30: 302 };
const A_TRANSIT: Record<string, number> = { L01: 7, L02: 7, L03: 6, L04: 6, L05: 12, L06: 12, L07: 26, L08: 27, L09: 34, L10: 9, L11: 7, L12: 28, L13: 27, L14: 4, L15: 14, L16: 14, L17: 16, L18: 8, L19: 10, L20: 15, L21: 12, L22: 30, L23: 38, L24: 32, L25: 17, L26: 18, L27: 2, L28: 3, L29: 3, L30: 4 };
{
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [["Bluewater Global Logistics – Rate Offer", "", "", "", "", "", ""], ["Ref BGL/RFX/2026/118 · Valid 60 days · All rates INR, ALL-IN port to port incl. THC both ends, BAF/CAF, documentation. Free days: 14 at destination.", "", "", "", "", "", ""], [],
    ["S.No", "Lane code", "Mode", "Equipment / basis", "Rate (INR)", "Transit (days)", "Free days"]];
  LANES.forEach((l, i) => rows.push([i + 1, `${CODE[l.origin]}-${CODE[l.destination]}`, l.mode, l.stdUnit === "CBM" ? "LCL per CBM" : l.stdUnit === "KG" ? "Air per kg chargeable" : l.stdUnit, A_PRICES[l.lineId], A_TRANSIT[l.lineId], l.mode === "FCL" ? 14 : l.mode === "LCL" ? 7 : 0]));
  const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, "Rates");
  const q = XLSX.utils.aoa_to_sheet([["Question", "Response"], ["Q1 ISO 9001", "Yes – ISO 9001:2015 certified, cert no. IN-QMS-44821, valid to Mar 2028 (copy attached)"], ["Q2 IATA/FIATA", "FIATA member (FIATA ID 3391); IATA cargo agent no. 14-3 2201"], ["Q3 CFS", "Own CFS at Dronagiri, Nhava Sheva (Bluewater CFS)"], ["Q4 Claims ratio", "0.8% of shipments FY26"], ["Q5 Insurance", "Marine liability USD 2,000,000 per occurrence (certificate on request)"], ["Q6 Escalation SLA", "4 hours to branch manager, 24 hours to director"], ["Q7 ESG reporting", "Yes, per-shipment CO2e statement on invoice"], ["Q8 References", "Two references available on request"]]);
  XLSX.utils.book_append_sheet(wb, q, "Questionnaire");
  XLSX.writeFile(wb, path.join(DOCS, "vendor-A-excel-ignores-template.xlsx"));
  fs.writeFileSync(path.join(DOCS, "vendor-A-iso9001-certificate.txt"), `CERTIFICATE OF REGISTRATION\n\nThis is to certify that the Quality Management System of\nBLUEWATER GLOBAL LOGISTICS PVT LTD, Dronagiri Node, Nhava Sheva, Maharashtra\nhas been assessed and found to conform to ISO 9001:2015\nScope: Freight forwarding, customs brokerage and container freight station operations.\nCertificate No. IN-QMS-44821  ·  Issued 14 March 2025  ·  Valid until 13 March 2028\nCertification body: Bharat Quality Registrars (accredited)\n`);
}

// ---------- Vendor C: Word prose, INR, includes THC at origin only (partial basis), quotes 27/30, silently skips 3 ----------
const C_SKIP = ["L11", "L23", "L29"];
const C_PRICES: Record<string, number> = { L01: 45200, L02: 69800, L03: 43500, L04: 67100, L05: 37400, L06: 56100, L07: 159800, L08: 157000, L09: 229000, L10: 33100, L12: 164000, L13: 167500, L14: 22300, L15: 95900, L16: 57200, L17: 91800, L18: 34900, L19: 1990, L20: 2490, L21: 2320, L22: 3950, L24: 3860, L25: 2640, L26: 2280, L27: 126, L28: 171, L30: 318 };
{
  const paras: Paragraph[] = [
    new Paragraph({ text: "CorriGlobe Freight Services", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: "Ref CGF/2026/RFX-FRT · 14 September 2026", italics: true })] }),
    new Paragraph("Dear Sir,"),
    new Paragraph("Thank you for your enquiry for annual freight lanes. We are pleased to offer the following rates in Indian Rupees. All ocean and air rates are all-in port to port: terminal handling at both ends, BAF/CAF and documentation are included. Customs clearance and duties are excluded. Rates are valid for 60 days."),
    new Paragraph({ text: "Ocean freight – FCL", heading: HeadingLevel.HEADING_2 }),
  ];
  for (const l of LANES.filter(l => l.mode === "FCL")) { if (C_SKIP.includes(l.lineId)) continue; paras.push(new Paragraph(`For ${label(l.lineId)} we can offer INR ${C_PRICES[l.lineId].toLocaleString("en-IN")} per ${l.stdUnit === "40HC" ? "forty-foot high cube" : "twenty-foot standard"} container all-in, transit approximately ${A_TRANSIT[l.lineId] + 2} days, 10 free days at destination.`)); }
  paras.push(new Paragraph({ text: "Ocean freight – LCL", heading: HeadingLevel.HEADING_2 }));
  for (const l of LANES.filter(l => l.mode === "LCL")) { if (C_SKIP.includes(l.lineId)) continue; paras.push(new Paragraph(`For LCL ${label(l.lineId)} our rate is INR ${C_PRICES[l.lineId].toLocaleString("en-IN")} per cubic metre all-in, minimum one cubic metre.`)); }
  paras.push(new Paragraph({ text: "Air freight", heading: HeadingLevel.HEADING_2 }));
  for (const l of LANES.filter(l => l.mode === "AIR")) { if (C_SKIP.includes(l.lineId)) continue; paras.push(new Paragraph(`Air freight ${label(l.lineId)}: INR ${C_PRICES[l.lineId]} per chargeable kilogram, minimum 100 kg, transit ${A_TRANSIT[l.lineId] + 1} days.`)); }
  paras.push(new Paragraph({ text: "Your questionnaire", heading: HeadingLevel.HEADING_2 }));
  paras.push(new Paragraph("We confirm we are ISO 9001:2015 certified (certificate no. QMS-IN-2211, valid to November 2027). We are a FIATA member but not an IATA agent; air shipments move under our IATA partner's licence. We do not operate our own CFS and use Speedy CFS at Nhava Sheva. Our claims ratio last year was 1.4%. Our marine liability cover is INR 8 crore per occurrence; the cover note is attached. Exceptions are escalated to a named manager within 6 working hours. We are working towards per-shipment emissions reporting and expect to offer it from Q2 next year. References can be shared on award."));
  paras.push(new Paragraph("We look forward to working with you."), new Paragraph("Yours faithfully, S. Menon, Commercial Head"));
  const doc = new Document({ sections: [{ children: paras }] });
  fs.writeFileSync(path.join(DOCS, "vendor-C-word-prose.docx"), await Packer.toBuffer(doc));
  fs.writeFileSync(path.join(DOCS, "vendor-C-insurance-cover-note.txt"), `COVER NOTE – MARINE LIABILITY (FREIGHT FORWARDER'S LIABILITY)\nInsured: CorriGlobe Freight Services Pvt Ltd, Andheri East, Mumbai\nPolicy no. MFL/2026/00931 · Period 01 Apr 2026 to 31 Mar 2027\nLimit of liability: INR 8,00,00,000 (Rupees eight crore) any one occurrence\nInsurer: Oriental Marine Assurance Co. Ltd.\n`);
}

// ---------- Vendor E: plain email, USD, freight only, "Jebel Ali 20s" ambiguous, Singapore "same as last year +3%", LCL passed ----------
{
  const eml = `From: ops@harbourline.example
To: procurement@aerchain.example
Subject: Re: RFX-2026-09-FRT – our rates
Date: Sat, 19 Sep 2026 17:05:11 +0530

Hi,

Sorry for the delay. Rates below, USD, freight only, THC and documentation extra at actuals, 7 free days destination.

USD 1,250 for the Jebel Ali 20s, 1,900 for the 40s. Singapore same as last year plus 3%. Rotterdam 40 HC ex Nhava Sheva USD 1,780, ex Mundra USD 1,760. LA 40 HC USD 2,590. Chennai to Singapore 20 GP USD 365, Chennai to Port Klang 40 HC USD 470. Hamburg 40 HC USD 1,860, Felixstowe 40 HC USD 1,900. Colombo 20 GP USD 245. Imports: Shanghai to Nhava Sheva 40 HC USD 1,060 and 20 GP USD 630, Busan to Chennai 40 HC USD 1,010, Jebel Ali to Mundra 20 GP USD 390.

LCL lanes we pass this year.

Air ex BOM per kg chargeable: DXB USD 1.40, SIN USD 1.90, AMS USD 2.75, ORD USD 3.45. Min 100 kg.

On your questions: we are ISO 9001 certified (cert attached separately, will send Monday), IATA agent yes, we use Continental CFS at Nhava Sheva, insurance is USD 1.5M with New India. Rest we can discuss on the call.

Regards,
Vikram
Harbourline Shipping & Air, Mundra
`;
  fs.writeFileSync(path.join(DOCS, "vendor-E-email-only.eml"), eml);
  fs.writeFileSync(path.join(DOCS, "vendor-E-reference-letter.txt"), `To whom it may concern\n\nMaharashtra Agro Exports Ltd has used Harbourline Shipping & Air for its FCL exports to the Gulf and Europe since 2021, approximately 620 TEU per year. Service has been reliable and claims minimal.\n\nR. Kulkarni, Head of Logistics, 2 September 2026\n`);
}

// ---------- Vendor D: photographed rate card (rendered flat, then "photographed" at an angle; the clean render never ships) ----------
{
  const { execFileSync } = await import("child_process"); const os = await import("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "card-")); const spec = path.join(tmp, "spec.json");
  fs.writeFileSync(spec, JSON.stringify({ name: VENDOR_D.name, validity: VENDOR_D.validity, basisNote: VENDOR_D.basisNote,
    fcl: VENDOR_D.fcl.map(r => ({ route: r.route, p20: r.p20, p40: r.p40, smudge: r.smudge ?? [] })), lcl: VENDOR_D.lcl.map(r => ({ route: r.route, price: r.price, smudge: !!r.smudge })), air: VENDOR_D.air.map(r => ({ route: r.route, price: r.price, smudge: !!r.smudge })) }));
  const res = execFileSync("python3", [path.join(process.cwd(), "scripts", "render_rate_card.py"), spec, path.join(tmp, "clean.png"), path.join(DOCS, "vendor-D-photo-rate-card.png")], { encoding: "utf8" });
  console.log("vendor-D photo:", res.trim());
}

// ---------- Answer key (never read by the app) ----------
type Cell = { expect: "value" | "missing" | "low_confidence" | "ambiguous_lane_match" | "prior_rate_reference"; price?: number; currency?: string; unitBasis?: string; illegible?: boolean; candidates?: string[] };
const unitOf = (id: string) => ({ "20GP": "per_20GP", "40HC": "per_40HC", CBM: "per_CBM", KG: "per_kg" } as Record<string, string>)[lane(id).stdUnit];
const truth: Record<string, any> = {};
truth["vendor-A"] = { file: "vendor-A-excel-ignores-template.xlsx", currency: "INR", basis: "all_in", cells: Object.fromEntries(LANES.map(l => [l.lineId, { expect: "value", price: A_PRICES[l.lineId], currency: "INR", unitBasis: unitOf(l.lineId) } as Cell])), questionnaire: { Q1: "yes", Q2: "yes", Q3: "partial", Q4: "yes", Q5: "yes", Q6: "partial", Q7: "yes", Q8: "partial" } };
truth["vendor-B"] = { file: "vendor-B-pdf-footnote-discount.pdf", currency: "USD", basis: "freight_only", cells: Object.fromEntries(LANES.map(l => [l.lineId, { expect: "value", price: VENDOR_B.prices[l.lineId], currency: "USD", unitBasis: unitOf(l.lineId) } as Cell])), conditions: [{ kind: "volume_discount", mustBeFlaggedNotApplied: true, pct: 4, thresholdTeu: 200, page: 2 }], questionnaire: Object.fromEntries(questionnaire.map(q => [q.id, "unanswered"])) };
truth["vendor-C"] = { file: "vendor-C-word-prose.docx", currency: "INR", basis: "all_in", cells: Object.fromEntries(LANES.map(l => [l.lineId, C_SKIP.includes(l.lineId) ? { expect: "missing" } : { expect: "value", price: C_PRICES[l.lineId], currency: "INR", unitBasis: unitOf(l.lineId) }])), questionnaire: { Q1: "yes", Q2: "partial", Q3: "partial", Q4: "yes", Q5: "partial", Q6: "partial", Q7: "partial", Q8: "partial" }, notes: "Q5 is INR 8 crore against a USD rule: cross-currency, buyer decides." };
{
  const d: Record<string, Cell> = {}; for (const l of LANES) d[l.lineId] = { expect: "missing" };
  for (const r of VENDOR_D.fcl) { if (r.map20) d[r.map20] = { expect: r.smudge?.includes("p20") ? "low_confidence" : "value", price: r.p20, currency: "INR", unitBasis: "per_20ft", illegible: r.smudge?.includes("p20") || undefined }; if (r.map40) d[r.map40] = { expect: r.smudge?.includes("p40") ? "low_confidence" : "value", price: r.p40, currency: "INR", unitBasis: "per_40ft", illegible: r.smudge?.includes("p40") || undefined }; }
  for (const r of VENDOR_D.lcl) if (r.map) d[r.map] = { expect: r.smudge ? "low_confidence" : "value", price: r.price, currency: "INR", unitBasis: "per_wm", illegible: r.smudge || undefined };
  for (const r of VENDOR_D.air) if (r.map) d[r.map] = { expect: r.smudge ? "low_confidence" : "value", price: r.price, currency: "INR", unitBasis: "per_kg", illegible: r.smudge || undefined };
  truth["vendor-D"] = { file: "vendor-D-photo-rate-card.png", currency: "INR", basis: "all_in", cells: d, questionnaire: Object.fromEntries(questionnaire.map(q => [q.id, "unanswered"])) };
}
{
  const E: Record<string, number> = { L07: 1780, L08: 1760, L09: 2590, L10: 365, L11: 470, L12: 1860, L13: 1900, L14: 245, L15: 1060, L16: 630, L17: 1010, L18: 390, L27: 1.4, L28: 1.9, L29: 2.75, L30: 3.45 };
  const e: Record<string, Cell> = {}; for (const l of LANES) e[l.lineId] = { expect: "missing" };
  for (const [id, p] of Object.entries(E)) e[id] = { expect: "value", price: p, currency: "USD", unitBasis: unitOf(id) };
  for (const id of ["L01", "L03"]) e[id] = { expect: "ambiguous_lane_match", candidates: ["L01", "L03"] };   // "Jebel Ali 20s" could be Nhava Sheva or Mundra
  for (const id of ["L02", "L04"]) e[id] = { expect: "ambiguous_lane_match", candidates: ["L02", "L04"] };
  for (const id of ["L05", "L06"]) e[id] = { expect: "prior_rate_reference" };                            // "Singapore same as last year plus 3%"
  truth["vendor-E"] = { file: "vendor-E-email-only.eml", currency: "USD", basis: "freight_only", cells: e, questionnaire: { Q1: "partial", Q2: "yes", Q3: "partial", Q4: "unanswered", Q5: "yes", Q6: "unanswered", Q7: "unanswered", Q8: "unanswered" }, notes: "LCL lanes L19–L26 explicitly passed." };
}
fs.writeFileSync(path.join(DATA, "ground_truth.json"), JSON.stringify({ generated_at: new Date().toISOString(), programme_teu: programmeTeu(), vendors: truth }, null, 2));
console.log(`rfq.json: ${rfq.lines.length} lanes, programme ${programmeTeu()} TEU · vendors.json: ${vendors.length} · docs: ${fs.readdirSync(DOCS).join(", ")} · ground_truth.json: ${Object.keys(truth).length} vendors`);
})().catch(e => { console.error(e); process.exit(1); });
