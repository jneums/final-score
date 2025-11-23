'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function Navigation() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  
  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };
  
  const linkClass = (path: string) => {
    const base = "text-sm font-medium transition-all";
    if (isActive(path)) {
      return `${base} text-primary drop-shadow-[0_0_8px_hsl(var(--primary))]`;
    }
    return `${base} text-muted-foreground hover:text-foreground`;
  };
  
  const mobileLinkClass = (path: string) => {
    const base = "block px-4 py-3 text-base font-medium transition-all border-l-4";
    if (isActive(path)) {
      return `${base} text-primary bg-primary/10 border-primary`;
    }
    return `${base} text-muted-foreground hover:text-foreground hover:bg-primary/5 border-transparent`;
  };
  
  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden sm:flex items-center gap-6">
        <Link href="/schedule" className={linkClass('/schedule')}>
          Schedule
        </Link>
        <Link href="/leaderboard" className={linkClass('/leaderboard')}>
          Leaderboard
        </Link>
        <Link 
          href="https://github.com/jneums/final-score" 
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          GitHub
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Link>
      </nav>
      
      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="sm:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>
      
      {/* Mobile Drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/50 z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Drawer */}
          <div className="fixed top-[65px] right-0 bottom-0 w-64 border-l-2 border-primary/40 z-40 sm:hidden shadow-2xl">
            <nav className="flex flex-col py-4  bg-card">
              <Link 
                href="/schedule" 
                className={mobileLinkClass('/schedule')}
                onClick={() => setIsOpen(false)}
              >
                Schedule
              </Link>
              <Link 
                href="/leaderboard" 
                className={mobileLinkClass('/leaderboard')}
                onClick={() => setIsOpen(false)}
              >
                Leaderboard
              </Link>
              <a 
                href="https://github.com/jneums/final-score" 
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-3 text-base font-medium text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all border-l-4 border-transparent"
                onClick={() => setIsOpen(false)}
              >
                <span className="flex items-center gap-2">
                  GitHub
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </span>
              </a>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
