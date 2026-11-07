const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createPreview} = require('../preview_nodes.cjs');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
test('node preview serves source assets, forwards paired evals, and rejects foreign origins and project writes', async () => {
  const received = [];
  const device = http.createServer((req,res) => {let body=''; req.on('data', b=>body+=b); req.on('end',()=>{received.push({url:req.url, headers:req.headers,body}); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true}));});});
  const deviceUrl = await listen(device), preview = createPreview({device:deviceUrl,token:'test-pairing-code'});
  const base = await listen(preview);
  try {
    let r = await fetch(base + '/tools/ui/nodes.html'); assert.equal(r.status,200); assert.match(await r.text(),/节点工作台/);
    r = await fetch(base + '/tools/ui/combo.js?f=editor-nodes.js,nodes-page.js'); assert.equal(r.status,200); assert.match(await r.text(),/initNodes/);
    r = await fetch(base + '/tools/ui/combo.js?f=..%2F..%2FREADME.md'); assert.equal(r.status,404);
    r = await fetch(base + '/eval',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-XScript-Client':'tools'},body:'{"code":"_result = 1"}'}); assert.equal(r.status,200);
    assert.equal(received[0].headers.authorization,'Bearer test-pairing-code');assert.equal(received[0].headers.origin,deviceUrl);assert.equal(received[0].body,'{"code":"_result = 1"}');
    assert.equal((await fetch(base+'/eval',{method:'POST',headers:{Origin:'https://foreign.invalid','X-XScript-Client':'tools'}})).status,403);
    assert.equal((await fetch(base+'/eval',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/projects/example',{method:'DELETE'})).status,405);
    assert.equal(received.length,1);
  } finally {await Promise.all([new Promise(r=>preview.close(r)),new Promise(r=>device.close(r))]);}
});
