# Final Score API Proxy Server

A lightweight Express.js proxy server to handle API Football requests and avoid CORS issues in the browser.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Add your API Football key to `.env`:
```
API_FOOTBALL_KEY=your_actual_key_here
```

## Development

```bash
npm run dev
```

Server will run on http://localhost:3001

## Production

### Deploy to Render

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Set the following:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variable**: `API_FOOTBALL_KEY` with your API key

### Environment Variables

- `API_FOOTBALL_KEY` (required) - Your API Football API key
- `PORT` (optional) - Server port (default: 3001)

## API Endpoints

### GET /health
Health check endpoint
```bash
curl http://localhost:3001/health
```

### GET /api/odds/:fixtureId
Get betting odds for a specific fixture
```bash
curl http://localhost:3001/api/odds/1234567?bookmakers=3
```

### GET /api/live/:fixtureId
Get live match data for a specific fixture
```bash
curl http://localhost:3001/api/live/1234567
```

### POST /api/live/batch
Get live match data for multiple fixtures
```bash
curl -X POST http://localhost:3001/api/live/batch \
  -H "Content-Type: application/json" \
  -d '{"fixtureIds": [1234567, 7654321]}'
```

## CORS Configuration

The server allows requests from:
- `https://vn2t6-yiaaa-aaaai-q4b4q-cai.icp0.io` (Production IC frontend)
- `http://localhost:3000` (Local development)
- `http://localhost:4943` (Local IC replica)

Update `index.js` to add additional origins as needed.
