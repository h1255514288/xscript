const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {EditorNodes: N} = require('../../android/app/src/main/assets/tools/editor-nodes.js');

test('node requests bound stalled headers and response bodies and support cancellation', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/headers') return;
    if (req.url === '/body') { res.writeHead(200, {'Content-Type':'application/json'}); res.write('{"ok":'); return; }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.deepEqual(await N.deviceRequest(base), {ok:true, status:200, data:{ok:true}});
    for (const path of ['/headers', '/body']) {
      await assert.rejects(N.deviceRequest(base + path, {}, 'json', null, 80), /响应超时/);
    }
    const controller = new AbortController();
    const pending = N.deviceRequest(base + '/body', {}, 'json', controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal((await N.deviceRequest(base)).data.ok, true, 'the next request works after cancellation');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
