import DraftCopilot from "@/components/DraftCopilot";
import { loadVendors } from "@/lib/normalize";
export const dynamic = "force-dynamic";
export default function DraftPage() {
  const vendors = loadVendors().map(v => ({ id: v.id, name: v.name, email: v.email ?? `sales@${v.id}.example` }));
  return (<>
    <h1>Draft an RFx</h1>
    <p className="sub">Describe what you need. The co-pilot builds the RFQ on the right using only explicit edits (shown under each reply), so nothing lands in the document that you didn't say or approve. Sending writes one email per vendor to a local outbox; SMTP is stubbed.</p>
    <DraftCopilot vendors={vendors} />
  </>);
}
