const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app  = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// --- config roblox ---
const ROBLOX_API_BASE = 'https://games.roblox.com/v1/games';
const PLACE_ID        = 109983668079237; // tu place
const MAX_SERVERS     = 100;             // por página

async function getRobloxServers(placeId, cursor = '') {
  const url = `${ROBLOX_API_BASE}/${placeId}/servers/Public`;
  const params = {
    limit: MAX_SERVERS,
    sortOrder: 'Desc',
    excludeFullGames: true,
    cursor: cursor || undefined
  };
  // borro keys undefined
  Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

  const { data } = await axios.get(url, {
    params,
    timeout: 15000,
    headers: {
      'User-Agent': 'Roblox-Servers-MicroAPI/1.0',
      'Accept': 'application/json'
    }
  });

  return data; // la respuesta oficial de Roblox
}

// raíz con info
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'roblox-microapi',
    placeId: PLACE_ID,
    endpoints: ['/health','/servers']
  });
});

// health
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// endpoint /servers
app.get('/servers', async (req, res) => {
  try {
    const cursor = req.query.cursor || '';
    const serversData = await getRobloxServers(PLACE_ID, cursor);
    // Devuelvo exactamente lo que espera la API principal:
    res.json({
      success: true,
      data: serversData,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
});

// 404
app.use('*', (_req, res) => res.status(404).json({ ok:false, error:'Not found' }));

app.listen(PORT, () => console.log(`🚀 MicroAPI listening on ${PORT}`));
