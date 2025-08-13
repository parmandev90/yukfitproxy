// server.js
'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

/* ========== ENV ========== */
const PORT = process.env.PORT || 8080;
const PY_BASE = (process.env.PYTHON_API || 'https://pythonapiyukfit.up.railway.app')
  .replace(/\/+$/, ''); // tanpa slash di akhir

const normalizeOrigin = s => (s || '').trim().replace(/\/+$/, '').toLowerCase();
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://yukfit.netlify.app,http://localhost:8080,http://localhost:5173'
).split(',').map(normalizeOrigin).filter(Boolean);

/* ========== fetch fallback (Node <18) ========== */
const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import('node-fetch').then(m => m.default(...args));

/* ========== CORS (preflight-safe) ========== */
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/health
    const ok = ALLOWED_ORIGINS.includes(normalizeOrigin(origin));
    return cb(null, ok);
  },
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Origin','X-Requested-With','Content-Type','Accept','Authorization'],
  optionsSuccessStatus: 204,
  preflightContinue: false,
  credentials: false,
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== In-memory storage (opsional) ========== */
const db = {
  items: [],
  add(d){ const id=Date.now().toString(); const rec={id,timestamp:new Date().toISOString(),...d}; this.items.push(rec); return rec; },
  exists(w,keys=['age','gender','height','weight','bmi']){ return this.items.some(it=>keys.every(k=>it[k]===w[k])); },
  all(){ return this.items; },
  byId(id){ return this.items.find(x=>x.id===id); },
};

/* ========== Helper proxy POST dengan fallback path ========== */
async function proxyPostWithFallback(body, candidatePaths) {
  const tried = [];
  for (const p of candidatePaths) {
    const url = `${PY_BASE}${p}`;
    tried.push(url);
    try {
      const r = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (r.ok) {
        try { return { ok: true, data: JSON.parse(text) }; }
        catch { return { ok: true, data: text }; }
      }
      // kalau 404 lanjut coba path lain
      if (r.status === 404) continue;
      return { ok: false, status: r.status, body: text, tried };
    } catch (e) {
      // network error → lanjut kandidat lain
      continue;
    }
  }
  return { ok: false, status: 404, body: 'No matching upstream path', tried };
}

/* ========== Routes ========== */
app.post('/api/recommend', async (req, res) => {
  try {
    const { ok, data, status, body, tried } = await proxyPostWithFallback(
      req.body,
      // daftar path yang akan dicoba berurutan
      ['/api/recommend','/recommend','/api/predict','/predict','/api/recommendations','/recommendations']
    );

    if (!ok) {
      console.error('Upstream not found/failed:', { status, tried });
      return res
        .status(status || 502)
        .json({ success:false, error:'Upstream not found/failed', status, tried });
    }
    return res.json(data);
  } catch (err) {
    console.error('Proxy error /api/recommend:', err);
    return res.status(502).json({ success:false, error:'Gagal menghubungi API Python' });
  }
});

app.post('/api/save', (req, res) => {
  try {
    const d = req.body;
    const reqd = ['age','gender','height','weight','bmi'];
    const miss = reqd.filter(k => d[k] === undefined || d[k] === null || d[k] === '');
    if (miss.length) return res.status(400).json({ success:false, error:`Data tidak lengkap: ${miss.join(', ')}` });
    if (db.exists(d)) return res.status(409).json({ success:false, error:'Data latihan serupa sudah ada' });
    const saved = db.add(d);
    return res.status(201).json({ success:true, message:'Tersimpan', data:{ id: saved.id } });
  } catch (e) {
    console.error('Error /api/save:', e);
    return res.status(500).json({ success:false, error:'Gagal menyimpan data' });
  }
});

app.get('/api/saved-workouts', (_req,res)=> res.json({ success:true, data: db.all() }));
app.get('/api/saved-workouts/:id', (req,res)=>{
  const it = db.byId(req.params.id);
  if (!it) return res.status(404).json({ success:false, error:'Tidak ditemukan' });
  res.json({ success:true, data: it });
});

app.get('/api/health', (_req,res)=>{
  res.json({
    ok:true,
    proxy:'up',
    python_api: PY_BASE,
    allowed_origins: ALLOWED_ORIGINS,
    time:new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
  console.log(`PYTHON_API      = ${PY_BASE}`);
  console.log(`ALLOWED_ORIGINS = ${ALLOWED_ORIGINS.join(', ')}`);
});
