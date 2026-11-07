/* Standalone inspector UI; generated selectors are executed by editor-nodes.test.cjs against the real runtime. */
const {test}=require('node:test'), assert=require('node:assert/strict');
const {spawn}=require('node:child_process'), fs=require('node:fs'), path=require('node:path');
const cdp=require('./cdp.cjs'), CHROME=cdp.find();
function startMock(){
  const child=spawn(process.env.PYTHON||'python3',['-u','-c','import sys,threading;sys.path.insert(0,"scripts");from mock_device import serve;s=serve();print(s.server_address[1],flush=True);threading.Event().wait()'],{cwd:path.resolve(__dirname,'../..'),stdio:['ignore','pipe','pipe']});
  const port=new Promise((resolve,reject)=>{let out='',err='';const timer=setTimeout(()=>reject(Error('mock timeout '+err)),5000);child.stderr.on('data',b=>{err+=b;});child.once('exit',code=>{clearTimeout(timer);reject(Error('mock exit '+code+err));});child.stdout.on('data',b=>{out+=b;if(out.includes('\n')){clearTimeout(timer);resolve(Number(out.trim()));}});});
  return {child,port};
}
test('standalone workbench and IDE handoff',{skip:!CHROME,timeout:60000+cdp.LAUNCH_BUDGET_MS},async t=>{
  const mock=startMock();let b;
  try{
    const base='http://127.0.0.1:'+await mock.port;b=await cdp.launch(CHROME);
    const click=id=>b.eval(id=>document.getElementById(id).click(),id);
    const pick=p=>b.eval(p=>document.querySelector('#node-tree [data-path="'+p+'"]').click(),p);
    const change=(id,value,type='change')=>b.eval((id,value,type)=>{const e=document.getElementById(id);e.type==='checkbox'?e.checked=value:e.value=value;e.dispatchEvent(new Event(type));},id,value,type);
    const condition=(field,part,value)=>b.eval((field,part,value)=>{const row=document.querySelector('.node-condition[data-field="'+field+'"]');const e=row.querySelector(part==='enabled'?'input[type=checkbox]':part==='op'?':scope > select':':scope > input');part==='enabled'?e.checked=value:e.value=value;e.dispatchEvent(new Event(part==='value'?'input':'change'));},field,part,value);
    const code=()=>b.eval(()=>document.getElementById('node-code').value);
    const waitTree=()=>b.waitFor(()=>document.querySelectorAll('#node-tree .node-row').length>0&&!document.getElementById('node-take').disabled&&!document.getElementById('node-shot').hidden);
    await b.goto(base+'/tools/ui/nodes.html');await waitTree();
    await t.test('separate page selects nodes from tree, screenshot and keyboard',async()=>{
      assert.equal(await b.eval(()=>!!document.getElementById('editor')),false);
      assert.equal(await b.eval(()=>document.getElementById('node-insert').hidden),true);
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),7);
      assert.equal(await b.eval(()=>document.getElementById('node-tree-count').textContent),'7');
      await pick('1/0/3');assert.equal(await code(),"from xscript.android import node\nhit = node.Selector().text('登录').clickable().find(timeout=5)");
      assert.equal(await b.eval(()=>document.getElementById('node-box').hidden),false);
      await b.eval(()=>{const img=document.getElementById('node-shot'),r=img.getBoundingClientRect();img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*540/1080,clientY:r.top+r.height*700/2400}));});
      assert.match(await code(),/com.demo.app:id\/user/);
      await pick('1/0/3');await b.key('ArrowUp','ArrowUp',38);assert.equal(await b.eval(()=>document.activeElement.dataset.path),'1/0/2');await pick('1/0/3');
    });
    await t.test('fit, zoom, hover and parent breadcrumbs preserve precise node picking',async()=>{
      await b.waitFor(()=>document.getElementById('node-shot').complete&&document.getElementById('node-shot').naturalWidth>0);
      const original=await code();
      await b.eval(()=>document.querySelector('#node-tree [data-path="1/0/1"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true})));
      assert.equal(await b.eval(()=>document.getElementById('node-hover-box').hidden),false);
      assert.equal(await code(),original,'hover does not change conditions');
      await change('node-zoom','200','input');
      assert.equal(await b.eval(()=>document.getElementById('node-zoom-value').textContent),'200%');
      await b.eval(()=>{const img=document.getElementById('node-shot'),r=img.getBoundingClientRect();img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*540/1080,clientY:r.top+r.height*700/2400}));});
      assert.match(await code(),/com.demo.app:id\/user/);
      await b.eval(()=>document.querySelectorAll('#node-breadcrumb button')[1].click());
      assert.match(await code(),/path\('1\/0'\)/);
      await click('node-fit');await pick('1/0/3');
      assert.equal(await b.eval(()=>document.getElementById('node-zoom-value').textContent),'适应');
    });
    await t.test('search, folding, full tree, refresh and stable alternatives',async()=>{
      await click('node-collapse');assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),2);await click('node-expand');
      await change('node-filter','登录','input');assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),3);
      await b.eval(()=>document.getElementById('node-filter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
      await change('node-full',true);await waitTree();assert.equal(await b.eval(()=>!!document.querySelector('#node-tree [data-path="1/0/4"]')),true);
      await pick('1/0');assert.match(await code(),/只能靠路径定位/);await click('node-alt-use');assert.match(await code(),/desc\('应用图标'\)/);
      await pick('1/0/3');await click('node-take');await waitTree();assert.match(await code(),/Selector\(1\).text\('登录'\)/);
      await change('node-full',false);await waitTree();
    });
    await b.eval(()=>{window.__realFetch=window.fetch;window.__sent=[];window.__reply={ok:true,result:'[["other",0,0,50,50],["1/0/3",80,980,1000,1110]]'};window.fetch=(url,opts)=>String(url)==='/eval'?(window.__sent.push(JSON.parse(opts.body)),Promise.resolve(new Response(JSON.stringify(window.__reply)))):window.__realFetch(url,opts);});
    await t.test('regex generation, copy and online test use the same conditions',async()=>{
      await condition('text','op','regex');await condition('text','value','(?i).*登录.*');await condition('clickable','enabled',false);
      assert.match(await code(),/\.regex\(\)\.text\('\(\?i\)\.\*登录\.\*'\)\.regex\(False\)/);
      await b.eval(()=>{const copy=XS.copy;XS.copy=text=>window.__copied=text;document.getElementById('node-copy').click();XS.copy=copy;});assert.equal(await b.eval(()=>window.__copied),await code());
      await b.eval(()=>{const copy=XS.copy;XS.copy=text=>window.__selector=text;document.getElementById('node-copy-selector').click();XS.copy=copy;});
      assert.equal(await b.eval(()=>window.__selector),"node.Selector().regex().text('(?i).*登录.*').regex(False)");
      await b.eval(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true})));
      await b.waitFor(()=>/匹配 2 个/.test(document.getElementById('node-try-result').textContent));assert.equal(await b.eval(()=>document.querySelectorAll('#node-hits .node-hit').length),2);
      assert.equal(await b.eval(()=>document.getElementById('node-match-count').textContent),'2 个');
      assert.equal(await b.eval(()=>document.getElementById('node-only-matches').checked),true);
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),3);
      assert.match(await b.eval(()=>window.__sent.at(-1).code),/re.compile\('\(\?i\)\.\*登录\.\*', re.S\)/);
      assert.doesNotMatch(await b.eval(()=>window.__sent.at(-1).code),/\.click\(|\.long_click\(/);
    });
    await t.test('result navigation reveals a search-hidden node without overwriting the query',async()=>{
      const original=await code();await change('node-filter','not-in-tree','input');
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),0);
      await b.eval(()=>document.querySelectorAll('#node-matches button')[1].click());
      assert.equal(await b.eval(()=>document.getElementById('node-filter').value),'');
      assert.equal(await b.eval(()=>document.querySelector('#node-tree .located')?.dataset.path),'1/0/3');
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-hits .focused').length),1);
      assert.equal(await code(),original);
    });
    await t.test('desktop, dark and narrow layouts keep actions visible without horizontal overflow',async()=>{
      for(const [name,width,height] of [['desktop',1440,960],['dark',1280,900],['mobile',390,844]]){
        await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await b.eval(dark=>{localStorage.setItem('xs-theme',dark?'dark':'light');XS.theme.apply();},name==='dark');
        await b.eval(()=>document.getElementById('node-copy').scrollIntoView({block:'nearest'}));
        assert.equal(await b.eval(()=>document.documentElement.scrollWidth<=innerWidth+1),true,name+' horizontal overflow');
        assert.equal(await b.eval(()=>{const r=document.getElementById('node-copy').getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight;}),true,name+' actions visible');
        assert.equal(await b.eval(()=>{const e=document.getElementById('node-copy'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,name+' actions not covered');
        if(name==='desktop'){
          const before=await b.eval(()=>document.querySelector('.node-screen').getBoundingClientRect().width);
          await b.eval(()=>document.getElementById('node-resize-screen').focus());await b.key('ArrowRight','ArrowRight',39);
          assert.ok(await b.eval(()=>document.querySelector('.node-screen').getBoundingClientRect().width)>before);
        }
        if(process.env.XS_SELECTOR_SHOT){const shot=await b.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.XS_SELECTOR_SHOT.replace(/\.png$/,'-'+name+'.png'),Buffer.from(shot.data,'base64'));}
      }await b.cmd('Emulation.clearDeviceMetricsOverride',{});
    });
    await t.test('custom field order is remembered without changing query conditions',async()=>{
      const before=await code();await click('node-layout-custom');
      await b.eval(()=>{const h=document.querySelector('.node-condition[data-field="text"] .node-drag');h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));});
      assert.equal(await b.eval(()=>document.querySelector('.node-condition').dataset.field),'text');
      assert.equal(await b.eval(()=>JSON.parse(localStorage.getItem('xs-node-field-order'))[0]),'text');
      assert.equal(await code(),before);await click('node-layout-grouped');
      assert.deepEqual(await b.eval(()=>[...document.querySelectorAll('.node-condition-section')].map(e=>e.textContent)),['基础属性','状态属性','结构属性']);
      await click('node-layout-custom');assert.equal(await b.eval(()=>document.querySelector('.node-condition').dataset.field),'text');
      await click('node-layout-reset');assert.equal(await b.eval(()=>document.querySelector('.node-condition').dataset.field),'id');await click('node-layout-grouped');
    });
    await t.test('reset ignores late results; invalid and empty conditions remain recoverable',async()=>{
      await b.eval(()=>{window.__before=window.fetch;window.fetch=(url,opts)=>String(url)==='/eval'?new Promise(resolve=>{window.__finish=()=>resolve(new Response(JSON.stringify({ok:true,result:'[["stale",0,0,1,1]]'})));}):window.__before(url,opts);document.getElementById('node-try').click();document.getElementById('node-reset').click();window.__shot=document.getElementById('node-shot').src;window.__finish();window.fetch=window.__before;});
      await b.eval(()=>new Promise(resolve=>setTimeout(resolve,100)));
      assert.deepEqual(await b.eval(()=>[document.querySelectorAll('#node-matches li, #node-hits .node-hit').length,document.getElementById('node-try').disabled,document.getElementById('node-shot').src===window.__shot]),[0,false,true]);
      assert.match(await code(),/\.text\('登录'\)\.clickable\(\)/);
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),7);
      await condition('text','enabled',false);await condition('clickable','enabled',false);assert.deepEqual(await b.eval(()=>['node-copy','node-insert','node-try'].map(id=>document.getElementById(id).disabled)),[true,true,true]);
      await click('node-reset');await condition('text','op','regex');await condition('text','value','[');await b.eval(()=>{window.__reply={ok:false,error:'re.error: unterminated character set'};});await click('node-try');await b.waitFor(()=>/unterminated/.test(document.getElementById('node-try-result').textContent));await click('node-reset');
    });
    await t.test('refresh keeps manual criteria and failed refresh keeps a clearly marked snapshot',async()=>{
      await condition('text','op','regex');await condition('text','value','.*登录.*');await change('node-relation','parent');
      const original=await code();await click('node-take');await waitTree();assert.equal(await code(),original);
      await b.eval(()=>{window.__beforeFailure=window.fetch;window.fetch=(url,opts)=>String(url).startsWith('/ui-tree')?Promise.reject(new TypeError('network failed')):window.__beforeFailure(url,opts);document.getElementById('node-take').click();});
      await b.waitFor(()=>/已保留上次节点和条件/.test(document.getElementById('node-info').textContent));
      assert.equal(await code(),original);
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),7);
      assert.equal(await b.eval(()=>document.getElementById('node-try').disabled),true);
      assert.match(await b.eval(()=>document.getElementById('node-shot-state').textContent),/旧截图/);
      await b.eval(()=>{window.fetch=window.__beforeFailure;document.getElementById('node-take').click();});await waitTree();assert.equal(await code(),original);
      assert.equal(await b.eval(()=>document.getElementById('node-try').disabled),false);await click('node-reset');
    });
    await t.test('stopping a pending test keeps the query and cancels its network requests',async()=>{
      const original=await code();await b.eval(()=>{window.__beforeCancel=window.fetch;window.__aborted=false;window.fetch=(url,opts)=>String(url)==='/eval'?new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>{window.__aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});}):window.__beforeCancel(url,opts);document.getElementById('node-try').click();});
      assert.equal(await b.eval(()=>document.getElementById('node-cancel').hidden),false);await click('node-cancel');
      assert.equal(await b.eval(()=>window.__aborted),true);assert.equal(await code(),original);
      assert.equal(await b.eval(()=>document.getElementById('node-try').disabled),false);
      await b.eval(()=>{window.fetch=window.__beforeCancel;});
    });
    await t.test('screen failure still reports query results and never paints matches on an old image',async()=>{
      await b.eval(()=>{window.__beforeScreenFailure=window.fetch;window.__reply={ok:true,result:'[["1/0/3",80,980,1000,1110]]'};window.fetch=(url,opts)=>String(url).startsWith('/screen')?Promise.reject(new TypeError('offline')):window.__beforeScreenFailure(url,opts);document.getElementById('node-try').click();});
      await b.waitFor(()=>/截图未刷新，结果见列表/.test(document.getElementById('node-try-result').textContent));
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-matches li').length),1);
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-hits .node-hit').length),0);
      assert.equal(await b.eval(()=>document.getElementById('node-box').hidden),true);
      await b.eval(()=>{window.fetch=window.__beforeScreenFailure;});await click('node-reset');
    });
    await t.test('XPath, relationships, all-match and action generation',async()=>{
      await change('node-relation','parent');assert.match(await code(),/\.parent\(1\)/);
      await change('node-kind','xpath');await change('node-xpath','//Button','input');assert.match(await code(),/xpath='\/\/Button'\)\.parent\(1\)/);
      await click('node-take');await waitTree();assert.match(await code(),/xpath='\/\/Button'\)\.parent\(1\)/);
      assert.equal(await b.eval(()=>document.getElementById('node-relations').hidden),false);
      await b.eval(()=>{window.__reply={ok:true,result:'[]'};});await click('node-try');await b.waitFor(()=>/没找到/.test(document.getElementById('node-try-result').textContent));assert.match(await b.eval(()=>window.__sent.at(-1).code),/xpath='\/\/Button'\)\.parent\(1\)/);
      await click('node-reset');await change('node-kind','all');assert.match(await code(),/hits = .*find_all\(timeout=0\)/);
      await change('node-kind','long_click');assert.match(await code(),/long_click\(\).find/);await change('node-kind','tap');assert.equal(await b.eval(()=>document.getElementById('node-try').disabled),true);await change('node-kind','find');
    });
    await t.test('missing node permission and screenshot failure are explained',async()=>{
      await b.eval(()=>{window.fetch=(url,opts)=>String(url).startsWith('/ui-tree')?Promise.resolve(new Response(JSON.stringify({error:'no_channel'}),{status:503})):window.__before(url,opts);document.getElementById('node-take').click();});await b.waitFor(()=>document.getElementById('node-info').classList.contains('error'));
      assert.equal(await b.eval(()=>document.querySelectorAll('#node-tree .node-row').length),7);assert.equal(await b.eval(()=>document.getElementById('node-a11y').hidden),false);
      await b.eval(()=>{window.__reply={ok:true,result:'0'};});await click('node-a11y');await b.waitFor(()=>/已在手机上打开/.test(document.getElementById('node-info').textContent));
      await b.eval(()=>{window.fetch=(url,opts)=>String(url).startsWith('/screen')?Promise.reject(Error('offline')):window.__realFetch(url,opts);document.getElementById('node-take').click();});await b.waitFor(()=>!document.getElementById('node-shot-note').hidden);await pick('1/0/3');assert.match(await code(),/登录/);
    });
    await t.test('IDE opens a new tab and only that tab may insert at the caret',async()=>{
      await fetch(base+'/projects/nodes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      await fetch(base+'/projects/nodes/files',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[{path:'__init__.py',content:'import time\n\ndef main():\n    \n    time.sleep(1)\n'}]})});
      await b.goto(base+'/tools/ui/editor.html?project=nodes&file=__init__.py');await b.waitFor(()=>!document.getElementById('editor').disabled);assert.equal(await b.eval(()=>!!document.getElementById('node-panel')),false);
      await b.eval(()=>{const open=window.open.bind(window);window.open=(...args)=>(window.__nodes=open(...args));});
      const point=await b.eval(()=>{const r=document.getElementById('node-toggle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
      await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      assert.deepEqual(b.errors,[]);
      await b.waitFor(()=>!!window.__nodes?.document.querySelector('#node-tree [data-path="1/0/3"]'));
      await b.eval(()=>{const e=document.getElementById('editor'),at=e.value.indexOf('    \n')+4;e.setSelectionRange(at,at);window.__nodes.document.querySelector('#node-tree [data-path="1/0/3"]').click();window.__nodes.document.getElementById('node-insert').click();});await b.waitFor(()=>document.getElementById('editor').value.includes("hit = node.Selector().text('登录')"));
      assert.equal(await b.eval(()=>document.getElementById('editor').value),"import time\nfrom xscript.android import node\n\ndef main():\n    hit = node.Selector().text('登录').clickable().find(timeout=5)\n    time.sleep(1)\n");
      await b.eval(()=>{window.__beforeSpoof=document.getElementById('editor').value;window.postMessage({type:'xscript:insert-node',token:new URL(window.__nodes.location).searchParams.get('editor'),code:'WRONG',imports:[]},location.origin);});await b.eval(()=>new Promise(resolve=>setTimeout(resolve,50)));assert.equal(await b.eval(()=>document.getElementById('editor').value===window.__beforeSpoof),true);await b.eval(()=>window.__nodes.close());
    });assert.deepEqual(b.errors,[]);
  }finally{if(b)await b.close();mock.child.kill();}
});
