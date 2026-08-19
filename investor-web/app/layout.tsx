import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARGO-S Investor Portal",
  description: "Контролируемый onboarding инвесторов для платформы токенизированных аграрных активов ARGO-S.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
