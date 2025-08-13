// server.js
'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const PYTHON_API = (process.env.PYTHON_API || 'https://pythonapiyukfit.up.railway.app')
  .replace(/\/+$/, ''); // hapus trailing slash

// Normalisasi origin: trim, buang trailing slash, lowercase
const normalizeOrigin = (s) => (s || '').trim().replace(/\/+$/, '').toLowerCase();

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://yukfit.netlify.app,http://localhost:8080,http://localhost:5173'
)
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

// ===== fetch fallback (Node < 18) =====
const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import('node-fetch').then(m => m.default(...args));

// ===== CORS (preflight-safe) =====
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // izinkan curl/health-check
    const o = normalizeOrigin(origin);
    if (ALLOWED_ORIGINS.includes(o)) return cb(null, true);
    // tolak dengan tenang: tidak set header CORS
    return cb(null, false);
  },
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Origin','X-Requested-With','Content-Type','Accept','Authorization'],
  optionsSuccessStatus: 204,
  preflightContinue: false,
  credentials: false,
  maxAge: 86400, // cache preflight 1 hari
};

app.use(cors(corsOptions));
// balas semua preflight; jika origin tidak diizinkan tetap 204 tapi TANPA header CORS
// browser tetap blokir — ini normal — tapi tidak akan 404 lagi
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== Storage sederhana (opsional) ======
const workoutStorage = {
  items: [],
  add(data) {
    const id = Date.now().toString();
    const saved = { id, timestamp: new Date().toISOString(), ...data };
    this.items.push(saved);
    return saved;
  },
  exists(w, keys = ['age','gender','height','weight','bmi']) {
    return this.items.some(it => keys.every(k => it[k] === w[k]));
  },
  findById(id) { return this.items.find(it => it.id === id); },
  getAll() { return this.items; },
};

// ====== PROXY -> Python API ======
app.post('/api/recommend', async (req, res) => {
  try {
    const upstream = await fetchFn(`${PYTHON_API}/api/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const bodyText = await upstream.text();
    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .type('application/json')
        .send(bodyText || JSON.stringify({ success: false, error: `Upstream ${upstream.status}` }));
    }

    let data; try { data = JSON.parse(bodyText); } catch { data = bodyText; }
    return res.json(data);
  } catch (err) {
    console.error('Proxy error /api/recommend:', err);
    return res.status(502).json({ success: false, error: 'Gagal menghubungi API Python' });
  }
});

// ====== Endpoints storage lokal (opsional) ======
app.post('/api/save', (req, res) => {
  try {
    const d = req.body;
    const reqd = ['age','gender','height','weight','bmi'];
    const miss = reqd.filter(f => d[f] === undefined || d[f] === null || d[f] === '');
    if (miss.length) {
      return res.status(400).json({ success:false, error:`Data tidak lengkap: ${miss.join(', ')}` });
    }
    if (workoutStorage.exists(d)) {
      return res.status(409).json({ success:false, error:'Data latihan yang sama sudah ada' });
    }
    const saved = workoutStorage.add(d);
    return res.status(201).json({ success:true, message:'Tersimpan', data:{ id: saved.id } });
  } catch (e) {
    console.error('Error /api/save:', e);
    return res.status(500).json({ success:false, error:'Gagal menyimpan data latihan' });
  }
});

app.get('/api/saved-workouts', (_req, res) =>
  res.json({ success:true, data: workoutStorage.getAll() })
);

app.get('/api/saved-workouts/:id', (req, res) => {
  const it = workoutStorage.findById(req.params.id);
  if (!it) return res.status(404).json({ success:false, error:'Data latihan tidak ditemukan' });
  return res.json({ success:true, data: it });
});

// ====== Health ======
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    proxy: 'up',
    python_api: PYTHON_API,
    allowed_origins: ALLOWED_ORIGINS,
    time: new Date().toISOString(),
  });
});

// Frontend dilayani Netlify
app.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
  console.log(`PYTHON_API      = ${PYTHON_API}`);
  console.log(`ALLOWED_ORIGINS = ${ALLOWED_ORIGINS.join(', ')}`);
});
