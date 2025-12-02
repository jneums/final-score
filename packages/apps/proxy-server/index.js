import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
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

  try {
    console.log(`Fetching odds for fixture ${fixtureId}`);
    
    const response = await fetch(
      `https://v3.football.api-sports.io/odds?fixture=${fixtureId}&bookmaker=8`,
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
            const homeOdds = matchWinnerBet.values.find(v => v.value === 'Home')?.odd || null;
            const drawOdds = matchWinnerBet.values.find(v => v.value === 'Draw')?.odd || null;
            const awayOdds = matchWinnerBet.values.find(v => v.value === 'Away')?.odd || null;
            
            odds.push({
              bookmaker: bookmaker.name,
              home: homeOdds,
              draw: drawOdds,
              away: awayOdds,
              updatedAt: fixtureOdds.update
            });
          }
        }
      }
    }

    res.json({ odds });
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for live match data
app.get('/api/live/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;

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

  try {
    console.log(`Fetching live data for ${fixtureIds.length} fixtures`);
    
    const idsParam = fixtureIds.join('-');
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
    
    const matches = (data.response || []).map(fixture => ({
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
    }));
    
    res.json({ matches });
  } catch (error) {
    console.error('Error fetching batch live data:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});
