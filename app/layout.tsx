import "./globals.css";
import Nav from "@/components/Nav";
export const metadata = { title: "QuoteIQ – RFX-2026-09-FRT freight lanes" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><div className="shell"><Nav /><main>{children}</main></div></body></html>);
}
