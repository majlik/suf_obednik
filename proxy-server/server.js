'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const fetch   = require('node-fetch');
const path    = require('path');
const zlib    = require('zlib');
const { URL } = require('url');

// Corporate networks often intercept HTTPS with their own certificate.
// Allow self-signed / corporate CA certs for outbound image search requests.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app    = express();
const PORT   = process.env.PORT || 3000;
const TARGET = 'http://194.160.223.198';

// ---------------------------------------------------------------------------
// In-memory image cache
// ---------------------------------------------------------------------------
const IMAGE_CACHE    = new Map();
const CACHE_TTL_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days

function cacheGet(key) {
  const entry = IMAGE_CACHE.get(key.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { IMAGE_CACHE.delete(key.toLowerCase()); return null; }
  return entry;
}
function cacheSet(key, images, isFallback) {
  IMAGE_CACHE.set(key.toLowerCase(), { images, isFallback, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Dobruchut.sk image search
// ---------------------------------------------------------------------------
async function searchDobruchut(term) {
  const url = `https://dobruchut.aktuality.sk/vyhladavanie/?q=${encodeURIComponent(term.trim())}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000, agent: httpsAgent });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const re = /<a[^>]+href=["'](https:\/\/dobruchut\.aktuality\.sk\/recept\/\d+\/[^"']+\/)["'][^>]*class=["'][^"']*image-wrapper[^"']*["'][\s\S]*?<img[^>]+(?:srcset|src)=["']([^"'\s,]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 5) {
      const slugMatch = m[1].match(/\/recept\/\d+\/([^/]+)\//);
      const title = slugMatch ? decodeURIComponent(slugMatch[1]).replace(/-/g, ' ') : term;
      results.push({ title, url: m[2].split(' ')[0], source: 'dobruchut' });
    }
    return results;
  } catch (err) {
    console.warn(`[dobruchut] "${term}": ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Wikipedia fallback
// ---------------------------------------------------------------------------
async function searchWikipedia(term) {
  for (const lang of ['cs', 'sk']) {
    try {
      const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search`
        + `&gsrsearch=${encodeURIComponent(term)}&gsrlimit=2&prop=pageimages&pithumbsize=600&format=json&origin=*`;
      const res  = await fetch(apiUrl, { timeout: 8000, agent: httpsAgent });
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) continue;
      const results = [];
      for (const page of Object.values(pages)) {
        if (page.thumbnail?.source) results.push({ title: page.title, url: page.thumbnail.source, source: `wikipedia-${lang}` });
      }
      if (results.length) return results;
    } catch (err) {
      console.warn(`[wikipedia-${lang}] "${term}": ${err.message}`);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// getMealImages
// ---------------------------------------------------------------------------
async function getMealImages(name, tiers, force, customQuery) {
  const key = customQuery ? `${name}__${customQuery}` : name;
  if (!force) { const cached = cacheGet(key); if (cached) return cached; }

  const queries = customQuery ? [customQuery] : tiers;
  let raw = [];
  for (const q of queries) { raw = await searchDobruchut(q); if (raw.length) break; }
  if (!raw.length) raw = await searchWikipedia(queries[queries.length - 1] || name);

  const result = { images: raw, isFallback: raw.length === 0 };
  cacheSet(key, raw, result.isFallback);
  return result;
}

// ---------------------------------------------------------------------------
// Image proxy — serves external images through localhost to avoid CSP/CORS
// ---------------------------------------------------------------------------
app.get('/api/img-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end('Missing url');
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      agent: httpsAgent,
      timeout: 10000,
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=2592000'); // 30 days
    upstream.body.pipe(res);
  } catch (err) {
    console.warn('[img-proxy] failed:', err.message);
    res.status(502).end();
  }
});

// ---------------------------------------------------------------------------
// API route
// ---------------------------------------------------------------------------
app.get('/api/image-search', async (req, res) => {
  const { name, tiers: tiersParam, force, customQuery } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const tiers = tiersParam ? tiersParam.split(',').map(t => t.trim()).filter(Boolean) : [name];
  try {
    const result = await getMealImages(name, tiers, force === '1', customQuery || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Static files (suf-inject.js)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// HTML injection + URL rewriting helpers
// ---------------------------------------------------------------------------
const TARGET_RE = /https?:\/\/194\.160\.223\.198(:\d+)?/g;
const VIEWPORT  = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const STYLE = `<style>
body { font-size: 16px !important; }
table.apeBROW { width: 100% !important; }
table.apeBROW td, table.apeBROW th { padding: 8px 6px !important; font-size: 14px !important; }
input[type=submit], button { min-height: 44px !important; padding: 8px 14px !important; font-size: 15px !important; }
img { max-width: 100%; height: auto; }
.suf-meal-flex { display: flex !important; align-items: center !important; gap: 10px !important; min-height: 54px !important; }
</style>`;
const SCRIPT = '<script src="/suf-inject.js"></script>';

function injectIntoHtml(html) {
  // Rewrite all absolute references to the target server so every link/form
  // stays within our proxy instead of escaping to the original server.
  html = html.replace(TARGET_RE, '');

  if (!html.includes('name="viewport"') && !html.includes("name='viewport'"))
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${VIEWPORT}`);
  html = html.replace(/<\/head>/i,  `${STYLE}\n</head>`);
  html = html.replace(/<\/body>/i,  `${SCRIPT}\n</body>`);
  if (!html.includes('</body>')) html += SCRIPT;  // fallback
  return html;
}

// ---------------------------------------------------------------------------
// Reverse proxy — manual, using Node's built-in http
// ---------------------------------------------------------------------------
app.use('/', (clientReq, clientRes) => {
  const targetUrl = new URL(clientReq.url, TARGET);

  // Build headers to send upstream
  const headers = { ...clientReq.headers };
  headers['host'] = targetUrl.host;
  if (headers['referer'])
    headers['referer'] = headers['referer'].replace(/^https?:\/\/[^/]+/, TARGET);
  if (headers['origin'])
    headers['origin'] = TARGET;
  headers['accept-encoding'] = 'gzip, deflate';
  ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
   'te', 'trailers', 'upgrade'].forEach(h => delete headers[h]);

  const options = {
    hostname : targetUrl.hostname,
    port     : targetUrl.port || 80,
    path     : targetUrl.pathname + targetUrl.search,
    method   : clientReq.method,
    headers,
    timeout  : 20000,
  };

  console.log(`[proxy] ${clientReq.method} ${targetUrl.pathname}${targetUrl.search}`);
  if (clientReq.method === 'POST') {
    console.log(`[proxy]   cookie: ${(headers['cookie'] || '').substring(0, 200)}`);
    console.log(`[proxy]   referer: ${headers['referer'] || '(none)'}`);
  }

  function sendUpstream(body) {
    const proxyReq = http.request(options, (proxyRes) => {
      // Rewrite Location redirect headers
      const loc = proxyRes.headers['location'] || '';
      if (loc) {
        proxyRes.headers['location'] = loc.replace(/^https?:\/\/194\.160\.223\.198(:\d+)?/, '');
      }
      console.log(`[proxy] ← ${proxyRes.statusCode} ${targetUrl.pathname}${loc ? '  →  ' + loc : ''}`);

      // Strip Set-Cookie domain/secure so cookies work on localhost
      if (proxyRes.headers['set-cookie']) {
        proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(c =>
          c.replace(/;\s*domain=[^;]+/gi, '').replace(/;\s*secure/gi, '')
        );
      }

      const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');

      if (!isHtml) {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
        return;
      }

      // HTML: decompress → inject → send
      const enc = proxyRes.headers['content-encoding'];
      let stream = proxyRes;
      if (enc === 'gzip')    stream = proxyRes.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = proxyRes.pipe(zlib.createInflate());

      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const original = Buffer.concat(chunks).toString('utf8');
        const modified = injectIntoHtml(original);
        const resHeaders = { ...proxyRes.headers };
        delete resHeaders['content-encoding'];
        delete resHeaders['content-length'];
        delete resHeaders['transfer-encoding'];
        resHeaders['content-type'] = 'text/html; charset=utf-8';
        clientRes.writeHead(proxyRes.statusCode, resHeaders);
        clientRes.end(modified);
      });
      stream.on('error', err => {
        console.error('[proxy] decompress error:', err.message);
        if (!clientRes.headersSent) clientRes.writeHead(500).end();
      });
    });

    proxyReq.on('timeout', () => {
      console.error('[proxy] timeout:', targetUrl.pathname);
      proxyReq.destroy();
      if (!clientRes.headersSent) clientRes.writeHead(504).end('Gateway timeout');
    });
    proxyReq.on('error', err => {
      console.error('[proxy] error:', err.message);
      if (!clientRes.headersSent) clientRes.writeHead(502).end('Proxy error: ' + err.message);
    });

    if (body) { proxyReq.write(body); proxyReq.end(); }
    else clientReq.pipe(proxyReq);
  }

  if (clientReq.method === 'POST') {
    // Buffer body so we can log it, then forward
    const bodyChunks = [];
    clientReq.on('data', c => bodyChunks.push(c));
    clientReq.on('end', () => {
      const body = Buffer.concat(bodyChunks);
      console.log(`[proxy]   body: ${body.toString('utf8').substring(0, 400)}`);
      sendUpstream(body);
    });
  } else {
    sendUpstream(null);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n✅ SUF Obedník proxy running at http://localhost:${PORT}`);
  console.log(`   Proxying → ${TARGET}`);
  console.log(`   On your phone (same WiFi): http://<your-local-IP>:${PORT}\n`);
});
