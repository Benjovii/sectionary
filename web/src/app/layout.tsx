import type { Metadata, Viewport } from "next";
import { Inter, Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

// Same three faces as Next Level: Inter carries the UI, Bricolage Grotesque
// the wordmark and titles, Geist Mono the ids and counts.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Sectionary", template: "%s · Sectionary" },
  description: "Real online stores, cut into blocks. Browse hero, buy box, reviews, FAQ and cart patterns at desktop and phone width.",
  applicationName: "Sectionary",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#110f0e" },
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${bricolage.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
