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
