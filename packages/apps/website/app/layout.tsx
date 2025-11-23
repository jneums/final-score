import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Navigation } from "./navigation";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Final Score | Sports Prediction Market",
  description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
  openGraph: {
    title: "Final Score | Sports Prediction Market",
    description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
    siteName: "Final Score",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Final Score | Sports Prediction Market",
    description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-6">
              <div className="flex h-20 items-center justify-between">
                <Link href="/" className="flex items-center gap-3 font-bold text-2xl text-foreground hover:text-primary transition-colors">
                  ⚽ Final Score
                </Link>
                <Navigation />
              </div>
            </div>
          </header>
          <main>{children}</main>
          <footer className="border-t-2 py-12 mt-20 bg-muted/20">
            <div className="container mx-auto px-4 text-center">
              <p className="text-base text-muted-foreground font-medium">
                Built with ❤️ on the Internet Computer
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
