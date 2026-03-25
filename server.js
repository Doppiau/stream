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

const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/proxy') {
    const targetUrl = parsed.query.url;
    if (!targetUrl) { res.writeHead(400); res.end('Falta parametro ?url='); return; }
    const isAllowed = ALLOWED_HOSTS.some(h => targetUrl.includes(h));
    if (!isAllowed) { res.writeHead(403); res.end('Host no permitido'); return; }
    const t = url.parse(targetUrl);
    proxyRequest(t.hostname, t.port || 80, t.path, req, res);
    return;
  }

  if (pathname.startsWith('/LiveApp/streams/')) {
    const [defaultHost, defaultPort] = ALLOWED_HOSTS[0].split(':');
    proxyRequest(defaultHost, defaultPort, pathname, req, res);
    return;
  }

  res.writeHead(404); res.end('Not found');
});

function proxyRequest(hostname, port, path, req, res) {
  const options = {
    hostname, port: parseInt(port), path, method: 'GET',
    headers: req.headers.range ? { Range: req.headers.range } : {}
  };
  const proxy = http.request(options, (upstream) => {
    const headers = Object.assign({}, upstream.headers);
    headers['access-control-allow-origin'] = '*';
    if (path.endsWith('.m3u8')) headers['content-type'] = 'application/vnd.apple.mpegurl';
    if (path.endsWith('.ts'))   headers['content-type'] = 'video/mp2t';
    res.writeHead(upstream.statusCode, headers);
    upstream.pipe(res);
  });
  proxy.on('error', (err) => { res.writeHead(502); res.end('Bad Gateway: ' + err.message); });
  proxy.end();
}

server.listen(PORT, () => console.log('Proxy activo en puerto ' + PORT));
