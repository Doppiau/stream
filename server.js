const http = require('http');
const url = require('url');

const ALLOWED_HOSTS = ['190.122.104.210:5080'];
const PORT = process.env.PORT || 3000;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}

function fetchUpstream(hostname, port, path, rangeHeader) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, port: parseInt(port), path, method: 'GET',
      headers: rangeHeader ? { Range: rangeHeader } : {}
    };
    const req = http.request(options, resolve);
    req.on('error', reject);
    req.end();
  });
}

function rewriteM3U8(content, proxyBase, originalBaseUrl) {
  const baseDir = originalBaseUrl.split('?')[0];
  const base = baseDir.substring(0, baseDir.lastIndexOf('/') + 1);
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    let segmentUrl;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      segmentUrl = trimmed;
    } else {
      segmentUrl = base + trimmed;
    }
    return proxyBase + encodeURIComponent(segmentUrl);
  }).join('\n');
}

const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Determinar targetUrl y hostname/port/path según la ruta
  let targetUrl, hostname, port, path;

  if (pathname === '/proxy') {
    targetUrl = parsed.query.url;
    if (!targetUrl) { res.writeHead(400); res.end('Falta parametro ?url='); return; }
    const isAllowed = ALLOWED_HOSTS.some(h => targetUrl.includes(h));
    if (!isAllowed) { res.writeHead(403); res.end('Host no permitido'); return; }
    const t = url.parse(targetUrl);
    hostname = t.hostname;
    port     = t.port || 80;
    path     = t.path;
  } else if (pathname.startsWith('/LiveApp/streams/')) {
    const [h, p] = ALLOWED_HOSTS[0].split(':');
    hostname  = h;
    port      = p;
    path      = pathname;
    targetUrl = `http://${ALLOWED_HOSTS[0]}${pathname}`;
  } else {
    res.writeHead(404); res.end('Not found'); return;
  }

  const urlPath = (targetUrl.split('?')[0]);
  const isM3u8  = urlPath.endsWith('.m3u8');
  const isTs    = urlPath.endsWith('.ts');

  try {
    const upstream = await fetchUpstream(hostname, port, path, req.headers.range);
    const headers  = Object.assign({}, upstream.headers);
    headers['access-control-allow-origin'] = '*';

    if (isM3u8) {
      let body = '';
      upstream.on('data', chunk => body += chunk.toString());
      upstream.on('end', () => {
        const proxyBase = `https://${req.headers.host}/proxy?url=`;
        const rewritten = rewriteM3U8(body, proxyBase, targetUrl);
        headers['content-type'] = 'application/vnd.apple.mpegurl';
        delete headers['transfer-encoding'];
        headers['content-length'] = Buffer.byteLength(rewritten).toString();
        res.writeHead(upstream.statusCode, headers);
        res.end(rewritten);
      });
    } else {
      if (isTs) headers['content-type'] = 'video/mp2t';
      res.writeHead(upstream.statusCode, headers);
      upstream.pipe(res);
    }
  } catch (err) {
    res.writeHead(502); res.end('Bad Gateway: ' + err.message);
  }
});

server.listen(PORT, () => console.log('Proxy HLS activo en puerto ' + PORT));
