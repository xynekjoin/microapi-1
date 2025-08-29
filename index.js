const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const ROBLOX_API_BASE = 'https://games.roblox.com/v1/games';
const MAX_SERVERS     = 100;
const PLACE_ID        = 109983668079237;

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
          'User-Agent': 'Roblox-Servers-MicroAPI/1.0',
          'Accept': 'application/json'
        }
      });

      const resData = response.data;
      if (resData && Array.isArray(resData.data)) {
        resData.data = resData.data.filter(s =>
          Number(s.playing || 0) <= 7 && Number(s.playing || 0) < Number(s.maxPlayers || 8)
        );
      }
      return resData;
    } catch (err) {
      const status = err.response?.status;
      const retriable =
        status === 429 || status >= 500 || err.code === 'ECONNABORTED';

      if (retriable && attempt < 4) {
        await sleep(400 * attempt);
        continue;
      }
      throw err;
    }
  }
}

app.get('/', (_, res) => {
  res.json({
    ok: true,
    name: 'roblox-servers-microapi',
    placeId: PLACE_ID,
    endpoints: ['/servers', '/health']
  });
});

app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/servers', async (req, res) => {
  try {
    const cursor     = req.query.cursor || '';
    const serversRes = await getRobloxServers(PLACE_ID, cursor);

    if (serversRes && Array.isArray(serversRes.data)) {
      serversRes.data = serversRes.data.filter(s =>
        Number(s.playing || 0) <= 7 && Number(s.playing || 0) < Number(s.maxPlayers || 8)
      );
    }

    res.json({
      success: true,
      data: serversRes,
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
app.listen(PORT, () => console.log(`MicroAPI listening on ${PORT}`));
