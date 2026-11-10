'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const fetch   = require('node-fetch');
const path    = require('path');
const zlib    = require('zlib');
const { URL, URLSearchParams } = require('url');

// Corporate networks often intercept HTTPS with their own certificate.
// Allow self-signed / corporate CA certs for outbound image search requests.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app    = express();
const PORT   = process.env.PORT || 3000;
const TARGET = 'http://194.160.223.198';

// Body parsers are scoped to /api routes only — the catch-all reverse proxy
// reads the raw POST body itself (e.g. the login form), so it must not be consumed here.
app.use('/api', express.json(), express.urlencoded({ extended: false }));

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
// GET /app — serve the SPA
// ---------------------------------------------------------------------------
// Redirect to the static file so it works both locally (express.static) and on
// Vercel, where public/ is served by the CDN and express.static is ignored.
app.get('/app', (req, res) => {
  res.redirect('/app.html');
});

// ---------------------------------------------------------------------------
// GET /api/meals — fetch and parse jidelnicek
// ---------------------------------------------------------------------------
app.get('/api/meals', async (req, res) => {
  const { week } = req.query;
  const url = week
    ? `http://194.160.223.198/index.php/obednar/jidelnicek?week=${encodeURIComponent(week)}`
    : `http://194.160.223.198/index.php/obednar/jidelnicek`;

  let html;
  try {
    const upstream = await fetch(url, {
      redirect: 'manual',
      headers: {
        'cookie': req.headers['cookie'] || '',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (upstream.status === 301 || upstream.status === 302) {
      return res.status(401).json({ error: 'not_logged_in' });
    }
    html = await upstream.text();
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  if (/name=["']heslo["']|name=["']login["']|prihlasenie|prihlásenie/i.test(html)) {
    return res.status(401).json({ error: 'not_logged_in' });
  }

  // --- Week nav ---
  const weekMatches = [...html.matchAll(/href=["'][^"']*week=(\d+)[^"']*/gi)];
  const prevWeek = weekMatches[0] ? weekMatches[0][1] : null;
  const nextWeek = weekMatches[1] ? weekMatches[1][1] : null;

  const weekLabelM = html.match(/(\d{1,2}\.\s*\d{1,2}\.[\s\S]{0,30}?\d{4})/);
  const weekLabel = weekLabelM ? weekLabelM[1].replace(/\s+/g, ' ').trim() : '';

  // --- Extract week field value from hidden inputs ---
  function extractWeekFromHtml(rowHtml) {
    const m = rowHtml.match(/name=["']week["'][^>]*value=["'](\d+)["']/) ||
              rowHtml.match(/value=["'](\d+)["'][^>]*name=["']week["']/);
    return m ? m[1] : (week || null);
  }

  // --- Parse table rows ---
  const days = [];
  let currentDay = null;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length === 0) continue;

    const cell0text = cells[0].replace(/<[^>]+>/g, '').trim();

    // Day header detection
    const colspanM = cells[0] && /<td[^>]*colspan=["']?(\d+)/i.exec(rowHtml);
    const colspan = colspanM ? parseInt(colspanM[1]) : 1;
    if (
      colspan > 1 ||
      /pondelok|utorok|streda|štvrtok|piatok/i.test(cell0text)
    ) {
      // Extract date key
      const dateM = cell0text.match(/(\d{1,2})\.(\d{1,2})\./);
      let dateKey = null;
      let label = cell0text.replace(/\s+/g, ' ').trim();
      if (dateM) {
        const yr = new Date().getFullYear();
        const mo = dateM[2].padStart(2, '0');
        const da = dateM[1].padStart(2, '0');
        dateKey = `${yr}${mo}${da}`;
      }
      currentDay = { label, dateKey, meals: [] };
      days.push(currentDay);
      continue;
    }

    // Meal row detection
    if (/^[p1-9]$/i.test(cell0text) && currentDay) {
      const rawNameHtml = cells[1] || '';
      const rawName = rawNameHtml.replace(/<[^>]+>/g, '').trim();
      const cleanName = rawName.replace(/\{[\s\S]*?\}/g, '').trim();

      // Allergens
      const allergenM = rawName.match(/\{[\s\S]*?alerg[eé]ny?[\s\S]*?([0-9,\s\/]+)[\s\S]*?\}/is);
      const allergens = allergenM
        ? allergenM[1].split(/[,\/]/).map(a => a.trim()).filter(Boolean)
        : [];

      // mealId
      const mealIdM = rowHtml.match(/name=["']id\[\]["'][^>]*value=["'](\d+)["']/) ||
                      rowHtml.match(/value=["'](\d+)["'][^>]*name=["']id\[\]["']/);
      const mealId = mealIdM ? mealIdM[1] : null;

      const rowWeek = extractWeekFromHtml(rowHtml);
      const isOrdered = /storno/i.test(rowHtml);
      const canCancel = isOrdered;
      const canOrder = /objednať/i.test(rowHtml) && !isOrdered;

      currentDay.meals.push({
        code: cell0text.toLowerCase(),
        rawName,
        cleanName,
        allergens,
        mealId,
        week: rowWeek,
        isOrdered,
        canOrder,
        canCancel,
      });
    }
  }

  res.json({ days, prevWeek, nextWeek, weekLabel });
});

// ---------------------------------------------------------------------------
// POST /api/order — place or cancel a meal order
// ---------------------------------------------------------------------------
app.post('/api/order', async (req, res) => {
  const { mealId, week, typ } = req.body;
  if (!mealId || !week || !typ) return res.status(400).json({ error: 'Missing fields' });

  const params = new URLSearchParams();
  params.append('id[]', mealId);
  params.append('week', week);
  params.append('typ', typ);

  try {
    const upstream = await fetch('http://194.160.223.198/index.php/obednar/objednat', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'cookie': req.headers['cookie'] || '',
        'content-type': 'application/x-www-form-urlencoded',
        'referer': 'http://194.160.223.198/index.php/obednar/jidelnicek',
        'User-Agent': 'Mozilla/5.0',
      },
      body: params.toString(),
    });
    if (upstream.status === 302 || (upstream.status >= 200 && upstream.status < 300)) {
      return res.json({ success: true });
    }
    return res.status(500).json({ error: `Unexpected status ${upstream.status}` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// HTML injection + URL rewriting helpers
// ---------------------------------------------------------------------------
const TARGET_RE = /https?:\/\/194\.160\.223\.198(:\d+)?/g;
const VIEWPORT  = '<meta name="viewport" content="width=device-width, initial-scale=1">';
// Mobile overrides live in public/suf-mobile.css; linked last in <head> so they win.
const STYLE = '<link rel="stylesheet" type="text/css" href="/suf-mobile.css">';
const SCRIPT = '<script src="/suf-inject.js"></script>';
const FAVICON = '<link rel="icon" type="image/png" sizes="32x32" href="/icon/32.png">\n'
  + '<link rel="apple-touch-icon" href="/icon/128.png">\n'
  + '<link rel="manifest" href="/manifest.webmanifest">\n'
  + '<meta name="theme-color" content="#2563eb">';

function injectIntoHtml(html) {
  // Rewrite all absolute references to the target server so every link/form
  // stays within our proxy instead of escaping to the original server.
  html = html.replace(TARGET_RE, '');

  if (!html.includes('name="viewport"') && !html.includes("name='viewport'"))
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${VIEWPORT}`);
  // Replace the original site's favicon with ours.
  html = html.replace(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi, '');
  html = html.replace(/<\/head>/i,  `${FAVICON}\n${STYLE}\n</head>`);
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
// On Vercel the exported app is wrapped as a serverless function; locally we listen.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅ SUF Obedník proxy running at http://localhost:${PORT}`);
    console.log(`   Proxying → ${TARGET}`);
    console.log(`   On your phone (same WiFi): http://<your-local-IP>:${PORT}\n`);
  });
}

module.exports = app;
