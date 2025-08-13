// server.js
'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const PYTHON_API =
  process.env.PYTHON_API || 'https://pythonapiyukfit.up.railway.app';

// Boleh koma-separated: "https://yukfit.netlify.app,https://localhost:8080"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://yukfit.netlify.app')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ===== fetch (fallback untuk Node < 18) =====
const fetchFn = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => import('node-fetch').then(m => m.default(...args));

// ===== Middlewares =====
app.use(
  cors({
    origin: (origin, cb) => {
      // izinkan tanpa Origin (mis. curl/health check)
      if (!origin) return cb(null, true);
      const ok = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
      return cb(null, ok);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== Storage sederhana (opsional) ======
const workoutStorage = {
  items: [],
  add(data) {
    const id = Date.now().toString();
    const saved = { id, timestamp: new Date(), ...data };
    this.items.push(saved);
    return saved;
  },
  exists(w, criteria = ['age', 'gender', 'height', 'weight', 'bmi']) {
    return this.items.some(it => criteria.every(k => it[k] === w[k]));
  },
  findById(id) {
    return this.items.find(it => it.id === id);
  },
  getAll() {
    return this.items;
  },
};

// ====== PROXY -> Python API ======
app.post('/api/recommend', async (req, res) => {
  try {
    const r = await fetchFn(`${PYTHON_API}/api/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body),
    });
    if (!r.ok) throw new Error(`Python API ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy error /api/recommend:', err);
    res.status(500).json({ success: false, error: 'Gagal menghubungi API Python' });
  }
});

// ====== Endpoints storage lokal (opsional) ======
app.post('/api/save', (req, res) => {
  try {
    const d = req.body;
    const required = ['age', 'gender', 'height', 'weight', 'bmi'];
    const miss = required.filter(f => d[f] === undefined || d[f] === null || d[f] === '');
    if (miss.length) {
      return res.status(400).json({
        success: false,
        error: `Data tidak lengkap. Field diperlukan: ${miss.join(', ')}`,
      });
    }
    if (workoutStorage.exists(d)) {
      return res.status(409).json({
        success: false,
        error: 'Data latihan dengan karakteristik yang sama sudah tersimpan',
      });
    }
    const saved = workoutStorage.add(d);
    res.status(201).json({ success: true, message: 'Tersimpan', data: { id: saved.id } });
  } catch (e) {
    console.error('Error /api/save:', e);
    res.status(500).json({ success: false, error: 'Gagal menyimpan data latihan' });
  }
});

app.get('/api/saved-workouts', (_req, res) =>
  res.json({ success: true, data: workoutStorage.getAll() })
);

app.get('/api/saved-workouts/:id', (req, res) => {
  const it = workoutStorage.findById(req.params.id);
  if (!it) return res.status(404).json({ success: false, error: 'Data latihan tidak ditemukan' });
  res.json({ success: true, data: it });
});

// ====== Health ======
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    proxy: 'up',
    python_api: PYTHON_API,
    time: new Date().toISOString(),
  });
});

// (Tidak ada static file/SPA fallback di proxy ini; frontend dilayani Netlify)

app.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
  console.log(`PYTHON_API = ${PYTHON_API}`);
  console.log(`ALLOWED_ORIGINS = ${ALLOWED_ORIGINS.join(', ')}`);
});
