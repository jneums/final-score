import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize cache
// Odds cache: 3 hours TTL (API updates every 3 hours)
const oddsCache = new NodeCache({ stdTTL: 3 * 60 * 60, checkperiod: 60 * 60 });
// Live data cache: 1 minute TTL (API updates every 15 seconds, we call every minute)
const liveCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

if (!API_FOOTBALL_KEY) {
  console.error('ERROR: API_FOOTBALL_KEY environment variable is required');
  process.exit(1);
}

// CORS configuration - allow all origins for now (tighten in production)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Additional CORS headers to ensure they're always present
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint for match odds
app.get('/api/odds/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  const { bookmakers = 3 } = req.query;
  const cacheKey = `odds:${fixtureId}:${bookmakers}`;

  // Check cache first
  const cached = oddsCache.get(cacheKey);
  if (cached) {
    console.log(`Returning cached odds for fixture ${fixtureId}`);
    return res.json(cached);
  }

  try {
    console.log(`Fetching odds for fixture ${fixtureId}`);
    
    const response = await fetch(
      `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`,
      {
        method: 'GET',
        headers: {
          'x-rapidapi-key': API_FOOTBALL_KEY,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API Football returned ${response.status}`);
    }

    const data = await response.json();
    
    // Transform the response to our format
    const odds = [];
    
    if (data.response && data.response.length > 0) {
      const fixtureOdds = data.response[0];
      
      if (fixtureOdds.bookmakers) {
        const topBookmakers = fixtureOdds.bookmakers.slice(0, parseInt(bookmakers));
        
        for (const bookmaker of topBookmakers) {
          const matchWinnerBet = bookmaker.bets.find(bet => bet.name === 'Match Winner');
          
          if (matchWinnerBet && matchWinnerBet.values) {
            const homeOdds = matchWinnerBet.values.find(v => v.value === 'Home')?.odd;
            const drawOdds = matchWinnerBet.values.find(v => v.value === 'Draw')?.odd;
            const awayOdds = matchWinnerBet.values.find(v => v.value === 'Away')?.odd;
            
            odds.push({
              bookmaker: bookmaker.name,
              home: homeOdds ? parseFloat(homeOdds) : null,
              draw: drawOdds ? parseFloat(drawOdds) : null,
              away: awayOdds ? parseFloat(awayOdds) : null,
              updatedAt: fixtureOdds.update
            });
          }
        }
      }
    }

    const result = { odds };
    
    // Cache the result (3 hours)
    oddsCache.set(cacheKey, result);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for live match data
app.get('/api/live/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  const cacheKey = `live:${fixtureId}`;

  // Check cache first
  const cached = liveCache.get(cacheKey);
  if (cached) {
    console.log(`Returning cached live data for fixture ${fixtureId}`);
    return res.json(cached);
  }

  try {
    console.log(`Fetching live data for fixture ${fixtureId}`);
    
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
      {
        method: 'GET',
        headers: {
          'x-rapidapi-key': API_FOOTBALL_KEY,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API Football returned ${response.status}`);
    }

    const data = await response.json();
    
    if (data.response && data.response.length > 0) {
      const fixture = data.response[0];
      
      const liveData = {
        fixtureId: fixture.fixture.id,
        status: fixture.fixture.status.short,
        elapsed: fixture.fixture.status.elapsed,
        scores: {
          home: fixture.goals.home,
          away: fixture.goals.away
        },
        teams: {
          home: fixture.teams.home.name,
          away: fixture.teams.away.name
        }
      };
      
      // Cache the result (1 minute)
      liveCache.set(cacheKey, liveData);
      
      res.json(liveData);
    } else {
      res.status(404).json({ error: 'Fixture not found' });
    }
  } catch (error) {
    console.error('Error fetching live data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for multiple live matches
app.post('/api/live/batch', async (req, res) => {
  const { fixtureIds } = req.body;

  if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) {
    return res.status(400).json({ error: 'fixtureIds array is required' });
  }

  // Check cache for all fixtures
  const cachedMatches = [];
  const uncachedIds = [];
  
  for (const fixtureId of fixtureIds) {
    const cacheKey = `live:${fixtureId}`;
    const cached = liveCache.get(cacheKey);
    if (cached) {
      cachedMatches.push(cached);
    } else {
      uncachedIds.push(fixtureId);
    }
  }

  // If all matches are cached, return them
  if (uncachedIds.length === 0) {
    console.log(`Returning all ${cachedMatches.length} matches from cache`);
    return res.json({ matches: cachedMatches });
  }

  try {
    console.log(`Fetching live data for ${uncachedIds.length} fixtures (${cachedMatches.length} from cache)`);
    
    const idsParam = uncachedIds.join('-');
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?ids=${idsParam}`,
      {
        method: 'GET',
        headers: {
          'x-rapidapi-key': API_FOOTBALL_KEY,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API Football returned ${response.status}`);
    }

    const data = await response.json();
    
    const fetchedMatches = (data.response || []).map(fixture => {
      const match = {
        fixtureId: fixture.fixture.id,
        status: fixture.fixture.status.short,
        elapsed: fixture.fixture.status.elapsed,
        scores: {
          home: fixture.goals.home,
          away: fixture.goals.away
        },
        teams: {
          home: fixture.teams.home.name,
          away: fixture.teams.away.name
        }
      };
      
      // Cache each match (1 minute)
      liveCache.set(`live:${match.fixtureId}`, match);
      
      return match;
    });
    
    // Combine cached and fetched matches
    const allMatches = [...cachedMatches, ...fetchedMatches];
    
    res.json({ matches: allMatches });
  } catch (error) {
    console.error('Error fetching batch live data:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});
