# Final Score Website

A Next.js website for the Final Score sports prediction market, featuring leaderboards and real-time statistics.

## About

Final Score is an AI-powered sports prediction market built on the Internet Computer. This website provides:

- **Leaderboards**: Track top predictors and compare performance
- **Live Statistics**: View active markets, total predictions, and value locked
- **Responsive Design**: Built with Next.js, React, and Tailwind CSS

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the site.

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui
- **Fonts**: Geist Sans & Geist Mono

## Project Structure

```
app/
  ├── page.tsx          # Home page
  ├── layout.tsx        # Root layout
  ├── navigation.tsx    # Navigation component
  ├── globals.css       # Global styles
  └── leaderboard/      # Leaderboard page (coming soon)

components/
  └── ui/               # UI components (buttons, cards, etc.)

lib/
  └── utils.ts          # Utility functions
```

## Learn More

- [Final Score GitHub](https://github.com/jneums/final-score)
- [Next.js Documentation](https://nextjs.org/docs)
- [Internet Computer](https://internetcomputer.org/)
