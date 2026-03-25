const http = require('http');
const url = require('url');

const ALLOWED_HOSTS = ['190.122.104.210:5080'];
const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  };
}

function fetchUpstream(targetUrl, rangeHeader) {
  return new Promise((resolve, reject) => {
    const t = url.parse(targetUrl);
    const options = {
      hostname: t.hostname,
      port: parseInt(t.port || 80),
      path: t.path,
      method: 'GET',
      headers: rangeHeader ? { Range: rangeHeader } : {}
    };
    const req = http.request(options, resolve);
    req.on('error', reject);
    req.end();
  });
}

function rewriteM3U8(content, proxyBase, originalBaseUrl) {
  return content.split('\n').map(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return line;

    // Construye la URL absoluta del segmento
    let segmentUrl;
    if (line.startsWith('http://') || line.startsWith('https://')) {
      segmentUrl = line;
    } else {
      // URL relativa — combina con la base
      const base = originalBaseUrl.substring(0, originalBaseUrl.lastIndexOf('/') + 1);
      segmentUrl = base + line;
    }

    // Reescribe para pasar por el proxy
    return proxyBase + encodeURIComponent(segmentUrl);
  }).join('\n');
}

const server = http.createServer(async (req, res) => {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname !== '/proxy') {
    res.writeHead(404); res.end('Not found'); return;
  }

  const targetUrl = parsed.query.url;
  if (!targetUrl) { res.writeHead(400); res.end('Falta ?url='); return; }

  const isAllowed = ALLOWED_HOSTS.some(h => targetUrl.includes(h));
  if (!isAllowed) { res.writeHead(403); res.end('Host no permitido'); return; }

  try {
    const upstream = await fetchUpstream(targetUrl, req.headers.range);
    const headers = Object.assign({}, upstream.headers, corsHeaders());

    if (targetUrl.endsWith('.m3u8')) {
      // Lee el contenido y reescribe las URLs de los segmentos
      let body = '';
      upstream.on('data', chunk => body += chunk.toString());
      upstream.on('end', () => {
        const proxyBase = `https://${req.headers.host}/proxy?url=`;
        const rewritten = rewriteM3U8(body, proxyBase, targetUrl);
        headers['content-type'] = 'application/vnd.apple.mpegurl';
        headers['content-length'] = Buffer.byteLength(rewritten).toString();
        res.writeHead(upstream.statusCode, headers);
        res.end(rewritten);
      });
    } else {
      // Segmentos .ts y otros — pipe directo
      if (targetUrl.endsWith('.ts')) headers['content-type'] = 'video/mp2t';
      res.writeHead(upstream.statusCode, headers);
      upstream.pipe(res);
    }
  } catch (err) {
    res.writeHead(502); res.end('Bad Gateway: ' + err.message);
  }
});

server.listen(PORT, () => console.log('Proxy HLS activo en puerto ' + PORT));
