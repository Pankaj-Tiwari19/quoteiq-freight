// Intended quotes for Vendor B (PDF, USD, freight only, footnote discount) and Vendor D
// (photographed INR rate card, per 20'/40', LCL per w/m, smudged cells, two lanes omitted).
// Read by the fixture generator and the ground-truth writer. Never by src/.

export const VENDOR_B = {
  vendorId: 'vendor-B',
  name: 'Meridian Ocean Lines Pvt. Ltd.',
  currency: 'USD',
  basis: 'freight only',
  // lineId -> USD price on the RFx's own unit (20GP / 40HC / CBM / kg chargeable)
  prices: {
    L01: 515, L02: 790, L03: 495, L04: 760, L05: 430, L06: 640, L07: 1850, L08: 1820, L09: 2650,
    L10: 380, L11: 480, L12: 1900, L13: 1950, L14: 260, L15: 1100, L16: 650, L17: 1050, L18: 400,
    L19: 22, L20: 28, L21: 26, L22: 45, L23: 62, L24: 44, L25: 30, L26: 26,
    L27: 1.45, L28: 1.95, L29: 2.85, L30: 3.6,
  } as Record<string, number>,
  footnotes: [
    'A volume rebate of 4% applies to all FCL rates where the committed annual programme exceeds 200 TEU across the lanes awarded to Meridian (40\'HC counted as 2 TEU). Rebate is settled quarterly in arrears against actual liftings.',
    'All rates are ocean/air freight only. Origin and destination THC, documentation, ISPS, and any BAF/CAF adjustments after 31 December 2026 are charged as per tariff at time of shipment.',
    'LCL rates are per revenue CBM, minimum 1 CBM per shipment. Air rates are per chargeable kg, minimum 100 kg.',
  ],
  validity: 'Valid for shipments effected up to 31 March 2027.',
  discountTeuThreshold: 200,
  discountPct: 4,
}

/** One printed row on Vendor D's card. A route row carries both a 20' and a 40' price whether or not we asked for both. */
export interface CardRouteRow {
  route: string           // as printed
  p20: number
  p40: number
  map20?: string          // our lineId for the 20' cell, if requested
  map40?: string
  smudge?: ('p20' | 'p40')[]
}
export interface CardSingleRow {
  route: string
  price: number
  map?: string
  smudge?: boolean
}

export const VENDOR_D = {
  vendorId: 'vendor-D',
  name: 'SeaCrest Freight & Logistics',
  currency: 'INR',
  basisNote: 'Rates include BAF/CAF. Origin THC, documentation and customs charges are extra at actuals.',
  validity: 'Valid till 31 Dec 2026',
  fcl: [
    { route: 'Nhava Sheva – Jebel Ali', p20: 44500, p40: 68900, map20: 'L01', map40: 'L02' },
    { route: 'Mundra – Jebel Ali', p20: 42800, p40: 66200, map20: 'L03', map40: 'L04' },
    { route: 'Nhava Sheva – Singapore', p20: 36900, p40: 55400, map20: 'L05', map40: 'L06' },
    { route: 'Nhava Sheva – Rotterdam', p20: 104000, p40: 158000, map40: 'L07', smudge: ['p40'] },
    { route: 'Mundra – Rotterdam', p20: 102500, p40: 155500, map40: 'L08' },
    { route: 'Nhava Sheva – Los Angeles', p20: 148000, p40: 226000, map40: 'L09' },
    { route: 'Chennai – Singapore', p20: 32500, p40: 48900, map20: 'L10' },
    { route: 'Chennai – Port Klang', p20: 28900, p40: 41500, map40: 'L11' },
    { route: 'Nhava Sheva – Hamburg', p20: 106500, p40: 162000, map40: 'L12' },
    // Felixstowe (L13) deliberately absent
    { route: 'Nhava Sheva – Colombo', p20: 21800, p40: 33900, map20: 'L14' },
    { route: 'Shanghai – Nhava Sheva (import)', p20: 56500, p40: 94800, map20: 'L16', map40: 'L15', smudge: ['p40'] },
    { route: 'Busan – Chennai (import)', p20: 61200, p40: 90500, map40: 'L17' },
    { route: 'Jebel Ali – Mundra (import)', p20: 34200, p40: 52800, map20: 'L18' },
  ] as CardRouteRow[],
  lcl: [
    { route: 'Nhava Sheva – Jebel Ali', price: 1950, map: 'L19', smudge: true },
    { route: 'Nhava Sheva – Singapore', price: 2450, map: 'L20' },
    { route: 'Chennai – Singapore', price: 2300, map: 'L21' },
    { route: 'Nhava Sheva – Rotterdam', price: 3900, map: 'L22' },
    { route: 'Nhava Sheva – Los Angeles', price: 5400, map: 'L23' },
    { route: 'Mundra – Hamburg', price: 3800, map: 'L24' },
    { route: 'Singapore – Nhava Sheva (import)', price: 2600, map: 'L25' },
    { route: 'Shanghai – Nhava Sheva (import)', price: 2250, map: 'L26' },
  ] as CardSingleRow[],
  air: [
    { route: 'BOM – DXB', price: 124, map: 'L27' },
    { route: 'BOM – SIN', price: 168, map: 'L28', smudge: true },
    { route: 'BOM – AMS', price: 245, map: 'L29' },
    // ORD (L30) deliberately absent
  ] as CardSingleRow[],
}
