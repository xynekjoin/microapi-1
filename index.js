// microapi – Roblox servers proxy (<7 players only)
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

// --- CONFIG ---
const ROBLOX_API_BASE = 'https://games.roblox.com/v1/games';
const PLACE_ID        = 109983668079237;  // tu place
const PAGE_LIMIT      = 100;              // Roblox máx 100 por página
const MAX_PLAYING     = parseInt(process.env.MAX_PLAYING || '6', 10); // <7

// --- middlewares ---
app.use(cors());
app.use(express.json());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama a Roblox y devuelve una página:
 *   { data: [ ... ], nextPageCursor: '...' }
 */
async function getRobloxServers(placeId, cursor = '') {
  const url = `${ROBLOX_API_BASE}/${placeId}/servers/Public`;
  const params = {
    limit: PAGE_LIMIT,
    sortOrder: 'Asc',
    cursor: cursor || undefined,
    excludeFullGames: true,  // evita 8/8 en origen
  };
  Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { data } = await axios.get(url, {
        params,
        timeout: 15000,
        headers: {
          'User-Agent': 'microapi-roblox/1.2',
          'Accept': 'application/json'
        }
      });
      return data;
    } catch (err) {
      const status = err.response?.status;
      const retriable =
        status === 429 || status >= 500 || err.code === 'ECONNABORTED';
      if (retriable && attempt < 4) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }
  }
}

// --- endpoints ---
app.get('/', (_, res) => {
  res.json({
    ok: true,
    name: 'microapi-roblox (<7 players)',
    placeId: PLACE_ID,
    filter: { maxPlaying: MAX_PLAYING },
    endpoints: ['/servers', '/health']
  });
});

app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    maxPlaying: MAX_PLAYING,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Devuelve UNA página de Roblox ya filtrada a jugadores <7.
 */
app.get('/servers', async (req, res) => {
  try {
    const cursor = req.query.cursor || '';
    const raw    = await getRobloxServers(PLACE_ID, cursor);

    // Filtramos solo <7 players
    const filtered = Array.isArray(raw.data)
      ? raw.data.filter(s => {
          const playing    = Number(s.playing || 0);
          const maxPlayers = Number(s.maxPlayers || 0);
          return (
            Number.isFinite(playing) &&
            Number.isFinite(maxPlayers) &&
            playing < MAX_PLAYING + 1 &&  // es decir, <7
            maxPlayers <= 8 &&
            typeof s.id === 'string'
          );
        })
      : [];

    res.json({
      success: true,
      data: {
        data: filtered,
        nextPageCursor: raw.nextPageCursor || null,
        previousPageCursor: raw.previousPageCursor || null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Request failed'
    });
  }
});

// 404
app.use('*', (_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`🚀 microapi (<7 players) on :${PORT}`);
});
