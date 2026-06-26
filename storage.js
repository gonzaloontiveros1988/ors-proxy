// storage.js — v1.0.0
// Persistencia en GitHub (reemplaza state.json local / Supabase)
// ==============================================================
// Guarda un único fichero JSON (el estado del sistema) en un repo PRIVADO de GitHub
// vía su API REST, usando solo `https` nativo (sin dependencias).
//
// Variables de entorno necesarias (en Render):
//   GITHUB_TOKEN  -> token fine-grained con permiso "Contents: Read and write" SOLO al repo de estado
//   GITHUB_REPO   -> "usuario/nombre-repo"   (ej: "gonzaloontiveros1988/trading-state")
//   GITHUB_PATH   -> ruta del fichero en el repo (default "state.json")
//   GITHUB_BRANCH -> rama (default "main")
//
// Por qué GitHub: gratis permanente, no caduca ni se pausa, histórico de versiones gratis,
// rate limit 5000/h (usamos ~12/h). El estado son pocos KB -> sobra.
//
// La API de GitHub exige el `sha` del fichero anterior para actualizarlo (control de
// concurrencia). Lo cacheamos tras cada lectura/escritura y lo refrescamos si hace falta.

'use strict';
const https = require('https');

const TOKEN  = process.env.GITHUB_TOKEN  || '';
const REPO   = process.env.GITHUB_REPO   || '';
const PATH   = process.env.GITHUB_PATH   || 'state.json';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

let cachedSha = null;

function enabled() { return !!(TOKEN && REPO); }

function ghRequest(method, body) {
  return new Promise((resolve, reject) => {
    const path = `/repos/${REPO}/contents/${encodeURIComponent(PATH).replace(/%2F/g,'/')}`;
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ors-trading-bot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Lee el estado (objeto JS) desde GitHub. Devuelve null si no existe o si falla.
async function load() {
  if (!enabled()) { console.log('[STORAGE] GitHub no configurado (faltan GITHUB_TOKEN/REPO)'); return null; }
  try {
    const r = await ghRequest('GET');
    if (r.status === 404) { console.log('[STORAGE] state.json aún no existe en el repo (primer arranque)'); return null; }
    if (r.status !== 200 || !r.body || !r.body.content) {
      console.log('[STORAGE] load status', r.status); return null;
    }
    cachedSha = r.body.sha;
    const json = Buffer.from(r.body.content, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) { console.log('[STORAGE] load error:', e.message); return null; }
}

// Guarda el estado (objeto JS) en GitHub (commit). Reintenta si el sha está obsoleto.
async function save(stateObj) {
  if (!enabled()) return false;
  const content = Buffer.from(JSON.stringify(stateObj)).toString('base64');
  const commit = {
    message: `state ${new Date().toISOString()}`,
    content,
    branch: BRANCH,
  };
  if (cachedSha) commit.sha = cachedSha;
  try {
    let r = await ghRequest('PUT', commit);
    // sha obsoleto (otra escritura entremedias) -> releer sha y reintentar una vez
    if (r.status === 409 || (r.status === 422 && cachedSha)) {
      const cur = await ghRequest('GET');
      if (cur.status === 200 && cur.body) { cachedSha = cur.body.sha; commit.sha = cachedSha; }
      r = await ghRequest('PUT', commit);
    }
    if (r.status === 200 || r.status === 201) {
      if (r.body && r.body.content) cachedSha = r.body.content.sha;
      return true;
    }
    console.log('[STORAGE] save status', r.status, r.body && r.body.message);
    return false;
  } catch (e) { console.log('[STORAGE] save error:', e.message); return false; }
}

module.exports = { load, save, enabled };
