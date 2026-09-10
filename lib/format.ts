export const inr = (n: number | null | undefined, d = 0) => n == null ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const inr0 = (n: number | null | undefined) => inr(n, 0);
export const pct = (n: number | null | undefined) => n == null ? "—" : n.toFixed(1) + "%";
export const unitLabel = (u: string) => u || "(unit?)";
export const reasonLabel: Record<string, string> = {
  missing_quote: "Not quoted", ambiguous_lane: "Check lane match", illegible: "Illegible in source", low_confidence: "Low confidence",
  unit_mismatch: "Unit differs from RFQ", unit_unstated: "Unit unstated", currency_unstated: "Currency unstated",
  basis_mismatch: "Freight-only / partial basis", needs_fx: "Needs FX rate", needs_density: "Needs cargo density", unresolvable_reference: "Refers to prior rate", conflicting_values: "Conflicting values",
};
export const basisLabel: Record<string, string> = { all_in: "All-in", freight_only: "Freight only", partial: "Partial (exclusions)", unstated: "Not stated" };
export const fmtLabel: Record<string, string> = { xlsx: "Excel", pdf: "PDF", docx: "Word", image: "Photo", email: "Email" };
