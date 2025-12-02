import type { Metadata } from "next";
import { Inter, Orbitron } from "next/font/google";
import Link from "next/link";
import { Navigation } from "./navigation";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://vn2t6-yiaaa-aaaai-q4b4q-cai.icp0.io"),
  title: "Final Score | Sports Prediction Market",
  description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
  icons: {
    icon: "/icon-final-score.webp",
    apple: "/icon-final-score.webp",
  },
  openGraph: {
    title: "Final Score | Sports Prediction Market",
    description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
    url: "https://vn2t6-yiaaa-aaaai-q4b4q-cai.icp0.io",
    siteName: "Final Score",
    images: [
      {
        url: "/banner-final-score.webp",
        width: 1200,
        height: 630,
        alt: "Final Score - AI-Powered Sports Prediction Market",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Final Score | Sports Prediction Market",
    description: "Predict football match outcomes and compete on the leaderboard. AI-powered prediction market built on the Internet Computer.",
    images: ["/banner-final-score.webp"],
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
        className={`${inter.variable} ${orbitron.variable} antialiased flex flex-col min-h-screen`}
      >
        <Providers>
          <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-4 sm:px-6">
              <div className="flex h-16 sm:h-20 items-center justify-between gap-4">
                <Link href="/" className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity shrink-0">
                  <img 
                    src="/icon-final-score.webp" 
                    alt="Final Score Logo" 
                    className="h-8 sm:h-10 w-auto"
                  />
                  <span className="font-bold text-lg sm:text-2xl text-foreground" style={{ fontFamily: 'var(--font-orbitron)' }}>Final Score</span>
                </Link>
                <Navigation />
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="border-t-2 border-primary/20 py-12 bg-card/30">
          <div className="container mx-auto px-4">
            <div className="flex flex-col items-center gap-6">
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-sm sm:text-base text-muted-foreground font-medium">
                <div className="flex items-center gap-1">
                  <span>Live on</span>
                  <a 
                    href="https://prometheusprotocol.org/app/io.github.jneums.final-score" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                  >
                    Prometheus Protocol
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
                <span className="hidden sm:inline text-border/60">|</span>
                <div className="flex items-center gap-1">
                  <span>Powered by</span>
                  <a 
                    href="https://internetcomputer.org" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                  >
                    Internet Computer
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
              <div className="inline-flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                <span className="text-xs sm:text-sm text-muted-foreground font-medium whitespace-nowrap">MCP URL</span>
                <code className="text-xs sm:text-sm font-mono text-foreground">
                  https://ilyol-uqaaa-aaaai-q34kq-cai.icp0.io/mcp
                </code>
              </div>
            </div>
          </div>
        </footer>
        </Providers>
      </body>
    </html>
  );
}
