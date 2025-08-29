const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// === CONFIG ===
const ROBLOX_API_BASE = 'https://games.roblox.com/v1/games';
const MAX_SERVERS     = 100;
const PLACE_ID        = 109983668079237;

// pequeño helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getRobloxServers(placeId, cursor = '') {
  const url = `${ROBLOX_API_BASE}/${placeId}/servers/Public`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const params = {
        limit: MAX_SERVERS,
        sortOrder: 'Desc',
        cursor: cursor || undefined,
        excludeFullGames: true
      };
      Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

      const response = await axios.get(url, {
        params,
        timeout: 15000,
        headers: {
          'User-Agent': 'Roblox-Servers-MicroAPI/1.1',
          'Accept': 'application/json'
        }
      });

      // 🔥 Filtro duro: SOLO servers con 6 jugadores o menos
      if (response.data && Array.isArray(response.data.data)) {
        response.data.data = response.data.data.filter(s => {
          return s && typeof s.playing === 'number' && typeof s.maxPlayers === 'number'
                 && s.id && s.playing <= 6; // <= 6 jugadores
        });
      }

      return response.data; // { data:[...], nextPageCursor: '...' }
    } catch (err) {
      const status = err.response?.status;
      const retriable = (status === 429 || status >= 500 || err.code === 'ECONNABORTED');
      if (retriable && attempt < 4) {
        await sleep(500 * attempt);
        continue;
      }
      console.error('MicroAPI error:', status || err.message);
      throw err;
    }
  }
}

// Home
app.get('/', (_, res) => {
  res.json({
    ok: true,
    name: 'roblox-servers-microapi',
    placeId: PLACE_ID,
    endpoints: ['/servers', '/health']
  });
});

// Health
app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Página (con cursor) ya filtrada a <=6 jugadores
app.get('/servers', async (req, res) => {
  try {
    const cursor     = req.query.cursor || '';
    const serversRes = await getRobloxServers(PLACE_ID, cursor);

    res.json({
      success: true,
      data: serversRes, // { data:[ solo <=6 ], nextPageCursor }
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Request failed'
    });
  }
});

app.use('*', (_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`🚀 MicroAPI listening on ${PORT}`);
});
