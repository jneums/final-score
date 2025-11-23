'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navigation() {
  const pathname = usePathname();
  
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
  
  return (
    <nav className="flex items-center gap-6">
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
  );
}
