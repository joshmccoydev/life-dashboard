import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "../styles/tokens.css";

const displayFont = localFont({
  src: "../../public/fonts/albert-sans-variable.ttf",
  variable: "--font-display",
  display: "swap",
  weight: "100 900",
});
export const metadata: Metadata = {
  title: "LifeDash · Personal HUD",
  description: "An always-on, personal command center for your TV.",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={displayFont.variable}>
      <body>{children}</body>
    </html>
  );
}
