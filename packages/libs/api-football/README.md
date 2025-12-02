# @final-score/api-football

TypeScript client for interacting with the API-Football API (api-football.com).

## Features

- 📊 **Bookmaker Odds** - Fetch match odds from top bookmakers
- ⚽ **Live Scores** - Get real-time match scores and status
- ⏱️ **Match Timers** - Track elapsed time for in-progress matches
- 🔄 **Batch Queries** - Fetch data for multiple matches efficiently

## Installation

```bash
pnpm install @final-score/api-football
```

## Usage

### Initialize the Client

```typescript
import { ApiFootballClient } from '@final-score/api-football';

const client = new ApiFootballClient({
  apiKey: 'your_api_key_here',
});
```

### Fetch Bookmaker Odds

```typescript
// Get top 3 bookmakers for a match
const odds = await client.getOdds(fixtureId, 3);

odds.forEach(odd => {
  console.log(`${odd.bookmaker}: Home ${odd.home}, Draw ${odd.draw}, Away ${odd.away}`);
});
```

### Get Live Match Data

```typescript
// Single match
const liveMatch = await client.getLiveMatch(fixtureId);

if (liveMatch) {
  console.log(`${liveMatch.homeTeam} ${liveMatch.homeScore} - ${liveMatch.awayScore} ${liveMatch.awayTeam}`);
  console.log(`Status: ${liveMatch.status}, Elapsed: ${liveMatch.elapsed}'`);
}

// Multiple matches
const liveMatches = await client.getLiveMatches([fixtureId1, fixtureId2, fixtureId3]);
```

## API Reference

### Types

#### `Odds`
```typescript
interface Odds {
  bookmaker: string;
  home: number | null;
  draw: number | null;
  away: number | null;
  updatedAt: string;
}
```

#### `LiveMatch`
```typescript
interface LiveMatch {
  fixtureId: number;
  status: string; // "1H", "HT", "2H", "FT", etc.
  elapsed: number | null;
  homeScore: number;
  awayScore: number;
  homeTeam: string;
  awayTeam: string;
}
```

### Methods

#### `getOdds(fixtureId, maxBookmakers)`
Fetch bookmaker odds for a specific match.

- **fixtureId**: API Football fixture ID
- **maxBookmakers**: Maximum number of bookmakers to return (default: 3)
- **Returns**: `Promise<Odds[]>`

#### `getLiveMatch(fixtureId)`
Get live match data for a specific fixture.

- **fixtureId**: API Football fixture ID
- **Returns**: `Promise<LiveMatch | null>`

#### `getLiveMatches(fixtureIds)`
Get live match data for multiple fixtures.

- **fixtureIds**: Array of API Football fixture IDs
- **Returns**: `Promise<LiveMatch[]>`

## Match Status Codes

- `1H` - First Half
- `HT` - Half Time
- `2H` - Second Half
- `ET` - Extra Time
- `P` - Penalties
- `FT` - Full Time
- `AET` - After Extra Time
- `PEN` - After Penalties

## Getting an API Key

1. Visit [api-football.com](https://www.api-football.com/)
2. Sign up for a free account (100 requests/day)
3. Copy your API key from the dashboard
4. Set it in your environment: `NEXT_PUBLIC_API_FOOTBALL_KEY=your_key`

## License

MIT
