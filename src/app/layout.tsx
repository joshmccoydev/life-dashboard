import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LifeDash · Personal HUD",
  description: "An always-on, personal command center for your TV.",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
