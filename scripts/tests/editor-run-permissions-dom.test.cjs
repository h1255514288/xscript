const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const cdp = require('./cdp.cjs');

const CHROME = cdp.find();

function startMock() {
  const child = spawn(process.env.PYTHON || 'python3', ['-u', '-c',
    'import sys,threading;sys.path.insert(0,"scripts");from mock_device import serve;s=serve();print(s.server_address[1],flush=True);threading.Event().wait()'],
    {cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe']});
  const port = new Promise((resolve, reject) => {
    let out = '', err = ''; const timer = setTimeout(() => reject(Error('Mock startup timed out: ' + err)), 5000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('Mock exited ' + code + ': ' + err)); });
    child.stderr.on('data', b => { err += b; });
    child.stdout.on('data', b => { out += b; if (out.includes('\n')) { clearTimeout(timer); resolve(Number(out.trim())); } });
  });
  return {child, port};
}

test('Web IDE run permissions offer the correct settings and retry actions', {skip: !CHROME, timeout: 60000 + cdp.LAUNCH_BUDGET_MS}, async () => {
  const mock = startMock(); let browser;
  try {
    const base = 'http://127.0.0.1:' + await mock.port;
    await fetch(base + '/projects/nodes', {method: 'POST', headers: {'Content-Type':'application/json'}, body:'{}'});
    await fetch(base + '/projects/nodes/files', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({files:[{path:'__init__.py',content:'print(1)'}]})});
    const b = browser = await cdp.launch(CHROME);
    await b.goto(base + '/tools/ui/editor.html?project=nodes&file=__init__.py');
    await b.waitFor(() => !document.getElementById('editor').disabled);
      // 运行 whose reply lists accessibility as missing: the status line warns and offers the same one-tap fix
      await b.eval(() => {
        const real = window.fetch; window.__runA11y = null;
        window.fetch = (url, opts) => /\/projects\/[^/]+\/run$/.test(String(url)) ? Promise.resolve(new Response(JSON.stringify({ok: true, running: true, missing: [{label: '无障碍', why: '点击、滑动、输入、读取控件', where: '__init__.py:4'}]}), {headers: {'Content-Type': 'application/json'}}))
          : String(url) === '/eval' ? (window.__runA11y = JSON.parse(opts.body), Promise.resolve(new Response(JSON.stringify({ok: true, result: '0'}), {headers: {'Content-Type': 'application/json'}}))) : real(url, opts);
        document.getElementById('run').click();
      });
      await b.waitFor(() => /手机上还缺：无障碍/.test(document.getElementById('message').textContent));
      assert.deepEqual(await b.eval(() => [document.getElementById('message').classList.contains('error'), document.getElementById('run-a11y').hidden]), [true, false]);
      if (process.env.XS_NODES_SHOT) {
        await b.cmd('Emulation.setDeviceMetricsOverride', {width: 1280, height: 860, deviceScaleFactor: 2, mobile: false});
        await new Promise(r => setTimeout(r, 300));
        const shot = await b.cmd('Page.captureScreenshot', {format: 'png'});
        fs.writeFileSync(path.resolve(__dirname, '../..', process.env.XS_NODES_SHOT.replace(/ide-nodes\.png$/, 'ide-run-a11y.png')), Buffer.from(shot.data, 'base64'));
        await b.cmd('Emulation.clearDeviceMetricsOverride', {});
      }
      await b.eval(() => document.getElementById('run-a11y').click());
      await b.waitFor(() => /开启 XScript 后再运行/.test(document.getElementById('message').textContent));
      assert.deepEqual(await b.eval(() => [window.__runA11y.code, document.getElementById('run-a11y').textContent]), ['from xscript.android import permission\n_result = permission.request(permission.ACCESSIBILITY_SERVICE, 1)', '再运行一次']);
      // only the overlay missing: the button names that page and opens it; screen capture asks the phone instead
      await b.eval(() => {
        const real = window.fetch; window.__runFix = [];
        window.fetch = (url, opts) => /\/projects\/[^/]+\/run$/.test(String(url)) ? Promise.resolve(new Response(JSON.stringify({ok: true, running: true, missing: window.__missing}), {headers: {'Content-Type': 'application/json'}}))
          : (String(url) === '/eval' || String(url) === '/capture/request') ? (window.__runFix.push([String(url), opts.body ? JSON.parse(opts.body).code : null]), Promise.resolve(new Response(JSON.stringify({ok: true, result: '0'}), {headers: {'Content-Type': 'application/json'}}))) : real(url, opts);
        window.__missing = [{label: '悬浮窗权限', why: '悬浮窗、浮动菜单、网页窗口', where: '__init__.py:2'}];
        document.getElementById('run').click();
      });
      await b.waitFor(() => /手机上还缺：悬浮窗权限/.test(document.getElementById('message').textContent));
      assert.deepEqual(await b.eval(() => [document.getElementById('run-a11y').hidden, document.getElementById('run-a11y').textContent]), [false, '打开手机悬浮窗设置']);
      if (process.env.XS_NODES_SHOT) {
        await b.cmd('Emulation.setDeviceMetricsOverride', {width: 1280, height: 860, deviceScaleFactor: 2, mobile: false});
        await new Promise(r => setTimeout(r, 300));
        const shot = await b.cmd('Page.captureScreenshot', {format: 'png'});
        fs.writeFileSync(path.resolve(__dirname, '../..', process.env.XS_NODES_SHOT.replace(/ide-nodes\.png$/, 'ide-run-overlay.png')), Buffer.from(shot.data, 'base64'));
        await b.cmd('Emulation.clearDeviceMetricsOverride', {});
      }
      await b.eval(() => document.getElementById('run-a11y').click());
      await b.waitFor(() => /悬浮窗设置，允许 XScript 后再运行/.test(document.getElementById('message').textContent));
      await b.eval(() => { window.__missing = [{label: '图色权限（截图）', why: '找图', where: 'a.py:1'}]; document.getElementById('run').click(); });
      await b.waitFor(() => document.getElementById('run-a11y').textContent === '在手机上授权截图' && !document.getElementById('run-a11y').hidden);
      await b.eval(() => document.getElementById('run-a11y').click());
      await b.waitFor(() => /截图授权/.test(document.getElementById('message').textContent));
      assert.deepEqual(await b.eval(() => window.__runFix), [['/eval', 'from xscript.android import permission\n_result = permission.request(permission.OVERLAY, 1)'], ['/capture/request', null]]);
      assert.equal(await b.eval(() => document.getElementById('run-a11y').textContent), '再运行一次');
      // two missing: after the first fix the button offers the next one (下一项), then goes away
      await b.eval(() => { window.__runFix = []; window.__missing = [{label: '通知使用权', why: '监听通知', where: 'a.py:4'}, {label: '文件访问权限', why: '读写 /sdcard 里的文件', where: 'a.py:5'}]; document.getElementById('run').click(); });
      await b.waitFor(() => document.getElementById('run-a11y').textContent === '打开手机通知使用权设置' && !document.getElementById('run-a11y').hidden);
      await b.eval(() => document.getElementById('run-a11y').click());
      await b.waitFor(() => /还有 1 项，点「下一项」继续/.test(document.getElementById('message').textContent));
      assert.deepEqual(await b.eval(() => [document.getElementById('run-a11y').hidden, document.getElementById('run-a11y').textContent]), [false, '下一项：打开手机文件访问设置']);
      if (process.env.XS_NODES_SHOT) {
        await b.cmd('Emulation.setDeviceMetricsOverride', {width: 1280, height: 860, deviceScaleFactor: 2, mobile: false});
        await new Promise(r => setTimeout(r, 300));
        const shot = await b.cmd('Page.captureScreenshot', {format: 'png'});
        fs.writeFileSync(path.resolve(__dirname, '../..', process.env.XS_NODES_SHOT.replace(/ide-nodes\.png$/, 'ide-run-next.png')), Buffer.from(shot.data, 'base64'));
        await b.cmd('Emulation.clearDeviceMetricsOverride', {});
      }
      await b.eval(() => document.getElementById('run-a11y').click());
      await b.waitFor(() => /文件访问设置，允许 XScript 后再运行。/.test(document.getElementById('message').textContent));
      // the last fix done: the button runs the project again, and the new run's reply sets it up afresh
      assert.deepEqual(await b.eval(() => [document.getElementById('run-a11y').hidden, document.getElementById('run-a11y').textContent]), [false, '再运行一次']);
      assert.match(await b.eval(() => document.getElementById('message').textContent), /开启后点「再运行一次」$/);
      if (process.env.XS_NODES_SHOT) {
        await b.cmd('Emulation.setDeviceMetricsOverride', {width: 1280, height: 860, deviceScaleFactor: 2, mobile: false});
        await new Promise(r => setTimeout(r, 300));
        const shot = await b.cmd('Page.captureScreenshot', {format: 'png'});
        fs.writeFileSync(path.resolve(__dirname, '../..', process.env.XS_NODES_SHOT.replace(/ide-nodes\.png$/, 'ide-run-again.png')), Buffer.from(shot.data, 'base64'));
        await b.cmd('Emulation.clearDeviceMetricsOverride', {});
      }
      await b.eval(() => { window.__missing = []; document.getElementById('run-a11y').click(); });
      await b.waitFor(() => /^已请求运行 nodes$/.test(document.getElementById('message').textContent));
      assert.equal(await b.eval(() => document.getElementById('run-a11y').hidden), true);
      assert.deepEqual(await b.eval(() => window.__runFix.map(c => c[1].match(/permission\.(\w+), 1/)[1])), ['NOTIFICATION_LISTENER', 'MANAGE_EXTERNAL_STORAGE']);
    assert.deepEqual(b.errors, []);
  } finally { if(browser) await browser.close(); mock.child.kill(); }
});
