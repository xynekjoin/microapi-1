// index.js  (MicroAPI Roblox Servers)
// -----------------------------------
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// =================== CONFIG ====================
const PLACE_ID  = Number(process.env.PLACE_ID || 109983668079237);
const MAX_PER_PAGE = 100;

// Tiempo que un resultado permanece en caché por cursor
const CACHE_TTL_MS        = Number(process.env.CACHE_TTL_MS || 60_000); // 60s
// Cada cuánto se vuelve a precargar la primera página
const PRELOAD_INTERVAL_MS = Number(process.env.PRELOAD_INTERVAL_MS || 30_000); // 30s
// Timeout de la llamada a Roblox
const ROBLOX_TIMEOUT_MS   = Number(process.env.ROBLOX_TIMEOUT_MS || 10_000);

// ==============================================
const ROBLOX_API = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public`;

// Caché por cursor:  { key -> { savedAt, payload } }
const cachePages = new Map();
// Garantía de que no se harán dos fetch simultáneos al mismo cursor
const inflight   = new Map();

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const keyOf = (cursor) => cursor ? String(cursor) : 'FIRST';

// Llamada a Roblox con reintentos/backoff
async function fetchRobloxPage(cursor) {
  const params = {
    limit: MAX_PER_PAGE,
    sortOrder: 'Desc',
    cursor: cursor || undefined,
    excludeFullGames: true
  };
  Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

  // 4 intentos máximo
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await axios.get(ROBLOX_API, {
        params,
        timeout: ROBLOX_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Roblox-Servers-MicroAPI/1.0',
          'Accept': 'application/json'
        }
      });
      return res.data; // { data:[...], nextPageCursor, ... }
    } catch (err) {
      const status = err.response?.status;
      const retriable = status === 429 || status >= 500 || err.code === 'ECONNABORTED';
      if (retriable && attempt < 4) {
        await sleep(300 * attempt); // 300ms, 600ms, 900ms...
        continue;
      }
      throw err;
    }
  }
}

// Devuelve (desde caché o remoto) una página por cursor
async function getPage(cursor) {
  const k = keyOf(cursor);
  const now = Date.now();

  // 1) si hay caché fresca, devuélvela
  const cached = cachePages.get(k);
  if (cached && (now - cached.savedAt) < CACHE_TTL_MS) {
    return cached.payload;
  }

  // 2) si ya hay un fetch en curso para ese cursor, espera al mismo
  const existingPromise = inflight.get(k);
  if (existingPromise) {
    return existingPromise;
  }

  // 3) dispara el fetch y registra que está en vuelo
  const p = (async () => {
    try {
      const data = await fetchRobloxPage(cursor);
      // Guarda en caché
      cachePages.set(k, { savedAt: Date.now(), payload: data });
      return data;
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, p);
  return p;
}

// ---------------- ROUTES ------------------
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'roblox-servers-microapi',
    placeId: PLACE_ID,
    endpoints: ['/servers', '/health'],
    cacheTTLms: CACHE_TTL_MS,
    preloadIntervalMs: PRELOAD_INTERVAL_MS
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Entrega UNA página (según cursor), con caché y reintentos
app.get('/servers', async (req, res) => {
  const cursor = req.query.cursor || '';
  try {
    const page = await getPage(cursor);
    res.json({ success: true, data: page, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.response?.data?.message || err.message || 'Request failed'
    });
  }
});

// 404
app.use('*', (_, res) => res.status(404).json({ error: 'Not found' }));

// ---------------- PRELOAD ------------------
// Precarga periódica de la PRIMERA página para que siempre esté fresca
async function warmFirstPageLoop() {
  while (true) {
    try {
      await getPage('');
    } catch (e) {
      // no cortar el loop por errores de red
    }
    await sleep(PRELOAD_INTERVAL_MS);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 MicroAPI listening on ${PORT}`);
  // Preload en background
  warmFirstPageLoop();
});
