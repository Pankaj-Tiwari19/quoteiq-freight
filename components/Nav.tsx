"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["/draft", "Draft RFx"], ["/", "RFQ overview"], ["/responses", "Supplier responses"], ["/comparison", "Comparison"], ["/analyst", "AI analyst"], ["/award", "Award recommendation"], ["/trust", "Trust & audit"]];
export default function Nav() {
  const p = usePathname();
  return (<nav className="nav">
    <div className="brand">Quote<span>IQ</span></div>
    <div className="rfq">RFX-2026-09-FRT · Freight lanes FY27</div>
    {items.map(([h, l]) => <Link key={h} href={h} className={(h === "/" ? p === "/" : p.startsWith(h)) ? "active" : ""}>{l}</Link>)}
    <div className="principle">AI recommends. The buyer approves. Nothing on these screens is awarded until a person signs it off.</div>
  </nav>);
}
