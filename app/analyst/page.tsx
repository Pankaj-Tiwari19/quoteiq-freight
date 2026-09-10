import AnalystChat from "@/components/AnalystChat";
export default function AnalystPage() {
  return (<>
    <h1>AI analyst</h1>
    <p className="sub">Ask questions in plain language. The analyst answers only by running queries against the normalized dataset (the same functions the comparison and award screens use). Totals, rankings and FX sensitivity are computed by code; the model explains them and names what was excluded and why.</p>
    <AnalystChat />
  </>);
}
