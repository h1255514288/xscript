#!/usr/bin/env node
/* Loopback preview of local Web IDE assets against one paired device, without rebuilding the APK.
 * node scripts/preview_nodes.cjs --device http://PHONE:9860 [--port 19860]
 * Pairing code: XSCRIPT_TOKEN environment variable. Never stored or logged. */
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const ASSETS = path.resolve(__dirname, '../android/app/src/main/assets/tools');
const MIME = {html:'text/html; charset=utf-8', js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', png:'image/png', svg:'image/svg+xml'};

function createPreview({device, token = ''}) {
  const target = new URL(device);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('Use the device base URL, for example http://PHONE:9860');
  const server = http.createServer((req, res) => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const send = (status, body, type = 'text/plain; charset=utf-8') => {res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store'}); res.end(body);};
    // Only this loopback origin may use the device credential held in this process.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return send(403, 'Local preview only');
    let url; try { url = new URL(req.url, origin); } catch { return send(400, 'Invalid URL'); }
    if (url.origin !== origin) return send(403, 'Local preview only');
    if (req.method === 'GET' && url.pathname === '/') {res.writeHead(302, {Location:'/tools/ui/nodes.html'}); res.end(); return;}
    if (req.method === 'GET' && url.pathname.startsWith('/tools/ui/')) {
      const name = url.pathname.slice('/tools/ui/'.length);
      const names = name === 'combo.js' ? (url.searchParams.get('f') || '').split(',') : [name];
      if (!names.length || names.length > 40 || new Set(names).size !== names.length || names.some(n => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(n) || (name === 'combo.js' && !n.endsWith('.js')))) return send(404, 'Unknown asset');
      try {
        const content = names.length === 1 ? fs.readFileSync(path.join(ASSETS, names[0])) : names.map(n => fs.readFileSync(path.join(ASSETS, n), 'utf8')).join('\n;\n');
        return send(200, content, MIME[name.split('.').pop()] || 'application/octet-stream');
      } catch { return send(404, 'Unknown asset'); }
    }
    // This preview allows reading projects and explicit node evals. Project writes/run/delete are not proxied.
    if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/eval' && req.headers['x-xscript-client'] === 'tools')) return send(405, 'Node preview: copying and testing are available; save/run projects through the device IDE.');
    const headers = {'X-XScript-Client':'tools', Origin:target.origin, Referer:target.origin+'/'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['content-length']) headers['Content-Length'] = req.headers['content-length'];
    const proxy = (target.protocol === 'https:' ? https : http).request(new URL(url.pathname + url.search, target), {method:req.method, headers}, upstream => {
      const responseHeaders = {...upstream.headers, 'cache-control':'no-store'}; delete responseHeaders['set-cookie'];
      res.writeHead(upstream.statusCode, responseHeaders); upstream.pipe(res);
    });
    proxy.setTimeout(15000, () => proxy.destroy(new Error('Device timeout')));
    proxy.on('error', () => {if (!res.headersSent) send(502, 'Device unavailable; check its developer address and connection.'); else res.destroy();});
    res.on('close', () => proxy.destroy());
    req.pipe(proxy);
  });
  return server;
}
module.exports = {createPreview};
if (require.main === module) {
  try {
    const args = process.argv.slice(2), at = name => args[args.indexOf(name)+1];
    if (!args.includes('--device')) throw Error('Usage: node scripts/preview_nodes.cjs --device http://PHONE:9860 [--port 19860]; set XSCRIPT_TOKEN for pairing.');
    const port = args.includes('--port') ? Number(at('--port')) : 19860;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
    const server = createPreview({device:at('--device'), token:process.env.XSCRIPT_TOKEN || ''});
    server.on('error', error => {console.error('Preview failed: ' + error.code); process.exitCode = 1;});
    server.listen(port, '127.0.0.1', () => console.log('Node preview: http://127.0.0.1:' + port + '/tools/ui/nodes.html (Ctrl+C to stop)'));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
