// The buyer's 30 lanes. Source of truth for public/fixtures/lanes.csv and for the spike RFx.
// annualQty is in stdUnit: containers for FCL, CBM for LCL, kg chargeable for air.
// Programme TEU (40HC = 2 TEU) totals 434, comfortably above the 200 TEU threshold Vendor B's footnote uses.

import type { RfxLine } from './rfx-types'

const P: Record<string, string> = {
  INNSA: 'Nhava Sheva', INMUN: 'Mundra', INMAA: 'Chennai', INBOM: 'Mumbai (BOM)',
  AEJEA: 'Jebel Ali', SGSIN: 'Singapore', NLRTM: 'Rotterdam', USLAX: 'Los Angeles',
  MYPKG: 'Port Klang', DEHAM: 'Hamburg', GBFXT: 'Felixstowe', LKCMB: 'Colombo',
  CNSHA: 'Shanghai', KRPUS: 'Busan', AEDXB: 'Dubai (DXB)', NLAMS: 'Amsterdam (AMS)', USORD: 'Chicago (ORD)',
}

type Row = [id: string, mode: RfxLine['mode'], o: string, d: string, unit: RfxLine['stdUnit'], qty: number, density?: number]

const rows: Row[] = [
  // FCL — 18
  ['L01', 'FCL', 'INNSA', 'AEJEA', '20GP', 36],
  ['L02', 'FCL', 'INNSA', 'AEJEA', '40HC', 24],
  ['L03', 'FCL', 'INMUN', 'AEJEA', '20GP', 18],
  ['L04', 'FCL', 'INMUN', 'AEJEA', '40HC', 12],
  ['L05', 'FCL', 'INNSA', 'SGSIN', '20GP', 12],
  ['L06', 'FCL', 'INNSA', 'SGSIN', '40HC', 18],
  ['L07', 'FCL', 'INNSA', 'NLRTM', '40HC', 20],
  ['L08', 'FCL', 'INMUN', 'NLRTM', '40HC', 16],
  ['L09', 'FCL', 'INNSA', 'USLAX', '40HC', 14],
  ['L10', 'FCL', 'INMAA', 'SGSIN', '20GP', 10],
  ['L11', 'FCL', 'INMAA', 'MYPKG', '40HC', 8],
  ['L12', 'FCL', 'INNSA', 'DEHAM', '40HC', 10],
  ['L13', 'FCL', 'INNSA', 'GBFXT', '40HC', 8],
  ['L14', 'FCL', 'INNSA', 'LKCMB', '20GP', 12],
  ['L15', 'FCL', 'CNSHA', 'INNSA', '40HC', 24],
  ['L16', 'FCL', 'CNSHA', 'INNSA', '20GP', 12],
  ['L17', 'FCL', 'KRPUS', 'INMAA', '40HC', 8],
  ['L18', 'FCL', 'AEJEA', 'INMUN', '20GP', 10],
  // LCL — 8, per CBM with declared density (kg/CBM)
  ['L19', 'LCL', 'INNSA', 'AEJEA', 'CBM', 240, 350],
  ['L20', 'LCL', 'INNSA', 'SGSIN', 'CBM', 180, 420],
  ['L21', 'LCL', 'INMAA', 'SGSIN', 'CBM', 120, 300],
  ['L22', 'LCL', 'INNSA', 'NLRTM', 'CBM', 160, 380],
  ['L23', 'LCL', 'INNSA', 'USLAX', 'CBM', 90, 450],
  ['L24', 'LCL', 'INMUN', 'DEHAM', 'CBM', 110, 330],
  ['L25', 'LCL', 'SGSIN', 'INNSA', 'CBM', 200, 400],
  ['L26', 'LCL', 'CNSHA', 'INNSA', 'CBM', 260, 500],
  // Air — 4, per kg chargeable
  ['L27', 'AIR', 'INBOM', 'AEDXB', 'KG', 18000],
  ['L28', 'AIR', 'INBOM', 'SGSIN', 'KG', 12000],
  ['L29', 'AIR', 'INBOM', 'NLAMS', 'KG', 9000],
  ['L30', 'AIR', 'INBOM', 'USORD', 'KG', 6000],
]

export const LANES: RfxLine[] = rows.map(([lineId, mode, origin, destination, stdUnit, annualQty, density]) => ({
  lineId,
  mode,
  origin,
  originName: P[origin],
  destination,
  destinationName: P[destination],
  direction: origin.startsWith('IN') ? 'export' : 'import',
  stdUnit,
  annualQty,
  ...(density ? { cargoDensityKgPerCbm: density } : {}),
}))

export function lanesCsv(): string {
  const head = 'lineId,mode,origin,originName,destination,destinationName,direction,stdUnit,annualQty,cargoDensityKgPerCbm'
  return [head, ...LANES.map(l => [l.lineId, l.mode, l.origin, l.originName, l.destination, l.destinationName, l.direction, l.stdUnit, l.annualQty, l.cargoDensityKgPerCbm ?? ''].join(','))].join('\n') + '\n'
}

export function programmeTeu(): number {
  return LANES.filter(l => l.mode === 'FCL').reduce((t, l) => t + l.annualQty * (l.stdUnit === '40HC' ? 2 : 1), 0)
}
