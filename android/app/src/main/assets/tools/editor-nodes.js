"use strict";
// Web IDE 节点 dock: grab the phone's UI node tree (GET /ui-tree, protocol/openapi.yaml UiNode as dumped by NodeDumper),
// pick a node in the tree or on the screenshot, and generate xscript code for it. The helpers are pure (unit-tested in
// Node); code generation follows the desktop inspector (desktop/frontend/src/ui-tree.ts) so both write the same selectors.
(function (root) {
  const shortType = t => { if (!t) return ""; const i = t.lastIndexOf("."); return i >= 0 ? t.slice(i + 1) : t; };
  const contains = (r, x, y) => r.r > r.l && r.b > r.t && x >= r.l && x < r.r && y >= r.t && y < r.b;

  /** Deepest, then smallest, node whose rect contains the point. Later nodes win ties (they paint on top). */
  function hitTest(roots, x, y, excludeSystem = false) {
    let best = null, area = Infinity, depth = -1;
    const walk = (n, d) => {
      if (excludeSystem && n.package === "com.android.systemui") return;
      const r = n.rect;
      if (r && contains(r, x, y)) {
        const a = (r.r - r.l) * (r.b - r.t);
        if (!best || a < area || (a === area && d >= depth)) { best = n; area = a; depth = d; }
      }
      for (const c of n.children || []) walk(c, d + 1);
    };
    for (const n of roots || []) walk(n, 0);
    return best;
  }

  /** Nodes from a root down to `target` (inclusive), or [] when it is not in the tree. */
  function ancestry(roots, target) {
    const trail = [];
    const walk = n => { trail.push(n); if (n === target) return true; for (const c of n.children || []) if (walk(c)) return true; trail.pop(); return false; };
    for (const n of roots || []) if (walk(n)) return trail;
    return [];
  }

  const key = n => n.path || "";
  const matches = (n, q) => [n.text, n.desc, n.id, n.type, n.hint].some(v => v && String(v).toLowerCase().includes(q));

  /**
   * Visible rows for the tree view: {node, depth, hasChildren, expanded, match}. `collapsed` holds node paths the user
   * folded. With a filter only matching nodes and their ancestors are listed (ancestors always open).
   */
  function rows(roots, {collapsed = new Set(), filter = "", limit = 2000, excludeSystem = false, paths = null} = {}) {
    const q = String(filter || "").trim().toLowerCase(), out = [];
    let truncated = false;
    const keep = new Set();
    if (q || paths) {
      const mark = n => { let hit = (!q || matches(n, q)) && (!paths || paths.has(key(n))); for (const c of n.children || []) if (mark(c)) hit = true; if (hit) keep.add(n); return hit; };
      for (const n of roots || []) mark(n);
    }
    const walk = (list, depth) => {
      for (const n of list) {
        if (excludeSystem && n.package === "com.android.systemui") continue;
        if ((q || paths) && !keep.has(n)) continue;
        if (out.length >= limit) { truncated = true; return; }
        const kids = n.children || [], expanded = q || paths ? true : !collapsed.has(key(n));
        out.push({node: n, depth, hasChildren: kids.length > 0, expanded, match: q ? matches(n, q) : false});
        if (kids.length && expanded) walk(kids, depth + 1);
      }
    };
    walk(roots || [], 0);
    return {rows: out, truncated};
  }

  function count(roots) { let c = 0; const walk = n => { c++; for (const k of n.children || []) walk(k); }; for (const n of roots || []) walk(n); return c; }

  function label(n) {
    const t = String(n.text || n.desc || n.id || shortType(n.type) || n.path || "").trim();
    return t || "(无名称)";
  }

  /** Python string literal: single-quoted, backslash escapes. */
  const pyStr = v => "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\x00-\x1f\x7f]/g, c => c === "\n" ? "\\n" : c === "\r" ? "\\r" : "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")) + "'";
  /** XPath string literal; concat() when the value has both quote styles. */
  function xpathStr(v) {
    v = String(v);
    if (!v.includes('"')) return '"' + v + '"';
    if (!v.includes("'")) return "'" + v + "'";
    return "concat(" + v.split('"').map(p => '"' + p + '"').join(", '\"', ") + ")";
  }

  /** Fields the Selector / XPath filters on, in the order they are tried. A field is added only while the earlier
   *  ones still match other nodes of `roots` (e.g. every row of a list shares one resource id), so the code finds
   *  the picked node rather than the first look-alike. Without `roots` (or a unique match) the first field is enough;
   *  when none of them is unique the node's path pins it. */
  /** Clocks and timers rewrite their own text, so a selector on it stops matching; their text/desc are skipped. */
  function volatileText(n) {
    return /:id\/clock$/.test(n.id || "") || /(^|\.)(TextClock|Chronometer)$/.test(n.type || "");
  }

  function selectorFields(n, roots) {
    const all = []; const walk = x => { all.push(x); for (const k of x.children || []) walk(k); }; for (const r of roots || []) walk(r);
    const same = fields => all.filter(x => fields.every(f => x[f] === n[f]) && (!n.clickable || x.clickable)).length;
    const fields = [];
    for (const f of ["id", "text", "desc"]) {
      if (!n[f] || (f !== "id" && volatileText(n))) continue;
      fields.push(f);
      if (!roots || same(fields) <= 1) return fields;
    }
    if (!fields.length && n.type) fields.push("type");
    if (n.path) fields.push("path");
    return fields;
  }
  const CALL = {id: "id", text: "text", desc: "desc", type: "type", path: "path"};

  const FIELDS = [
    ["id", "资源 ID"], ["text", "文字"], ["desc", "描述"], ["type", "类名"],
    ["hint", "提示"], ["package", "包名"], ["path", "路径"],
    ["clickable", "可点击", true], ["editable", "可编辑", true],
    ["enabled", "已启用", true], ["visible", "可见", true],
    ["longClickable", "可长按", true, "long_clickable"], ["checkable", "可勾选", true],
    ["checked", "已勾选", true], ["focusable", "可聚焦", true], ["focused", "已聚焦", true],
    ["scrollable", "可滚动", true], ["selected", "已选中", true], ["classPath", "类名路径", false, "class_path"],
    ["depth", "深度", false, "depth", true], ["childCount", "子节点数", false, "child_count", true],
  ].map(([key, label, flag = false, call = key, number = false]) => ({key, label, flag, call, number}));
  function defaultCriteria(n, roots = null) {
    const chosen = new Set(selectorFields(n, roots));
    if (!chosen.size) chosen.add("path");
    if (n.clickable) chosen.add("clickable");
    return FIELDS.map(f => ({field: f.key, enabled: chosen.has(f.key), op: "exact", value: f.flag ? !!n[f.key] : f.number ? Number(n[f.key] ?? (f.key === "childCount" ? (n.children || []).length : Math.max(0, String(n.path || "").split("/").length - 1))) : String(n[f.key] ?? (f.key === "path" ? "0" : ""))}));
  }
  function criteriaError(criteria) {
    const active = criteria.filter(c => c.enabled);
    if (!active.length) return "请至少勾选一个匹配条件";
    for (const c of active) {
      const f = FIELDS.find(f => f.key === c.field);
      if (f?.number) { if (!Number.isInteger(c.value) || c.value < 0) return f.label + "必须是非负整数"; continue; }
      if (!f || (f.flag ? typeof c.value !== "boolean" : typeof c.value !== "string" || !["exact", "contains", "regex"].includes(c.op))) return "匹配条件无效";
      if (!f.flag && c.op !== "exact" && !c.value) return "包含或正则条件不能为空";
    }
    return "";
  }
  // Python re.fullmatch uses DOTALL in the runtime. Escape literal contains values, including whitespace/#.
  const regexLiteral = value => value.replace(/[.*+?^${}()|[\]\\\s#-]/g, "\\$&");
  function criteriaChain(criteria) {
    const error = criteriaError(criteria); if (error) throw new Error(error);
    return criteria.filter(c => c.enabled).map(c => {
      const f = FIELDS.find(f => f.key === c.field);
      if (f.number) return "." + f.call + "(" + c.value + ")";
      if (f.flag) return "." + f.call + "(" + (c.value ? "" : "False") + ")";
      if (c.op === "exact") return "." + f.call + "(" + pyStr(c.value) + ")";
      const pattern = c.op === "contains" ? ".*" + regexLiteral(c.value) + ".*" : c.value;
      return ".regex()." + f.call + "(" + pyStr(pattern) + ").regex(False)";
    }).join("");
  }

  /** `<module>.Selector(...)` chain: resource id, text, content-desc as needed to be unique in `roots`, else class +
   *  path; plus .clickable(). */
  function selectorChain(n, module = "node", mode = 0, roots = null, criteria = null) {
    if (criteria) return module + ".Selector(" + (mode ? "1" : "") + ")" + criteriaChain(criteria);
    const calls = selectorFields(n, roots).map(f => "." + CALL[f] + "(" + pyStr(n[f]) + ")");
    if (n.clickable) calls.push(".clickable()");
    const chain = calls.length ? calls.join("") : ".path(" + pyStr(n.path || "0") + ")";
    return module + ".Selector(" + (mode ? "1" : "") + ")" + chain;
  }

  /** One XPath for the node: resource-id, text, content-desc as needed to be unique in `roots`, else path. */
  function nodeXPath(n, roots = null) {
    const cls = shortType(n.type) || "*";
    const fields = selectorFields(n, roots).filter(f => f !== "type");
    if (!fields.length) return "//" + cls;
    const attr = {id: "resource-id", text: "text", desc: "content-desc", path: "path"};
    const tag = fields[0] === "id" || fields[0] === "path" ? "*" : cls;
    return "//" + tag + fields.map(f => "[@" + attr[f] + "=" + xpathStr(n[f]) + "]").join("");
  }

  /** Comment for code that only the node's path can pin (no unique id / text / desc): it breaks when the layout moves. */
  const FRAGILE = "# 没有唯一的 id、文字或描述，只能靠路径定位：界面变了可能找不到\n";
  const fragile = (n, roots) => selectorFields(n, roots).includes("path");

  /** For a node only its path can pin: the closest node that has a selector without the path, as {node, rel}. Children
   *  first (a list row's title), then parents (the button around an icon); at most 3 levels away. Siblings are other
   *  controls, so they are never offered. null when the node is stable already or nothing around it is. */
  function stableAlternative(n, roots) {
    if (!roots || !fragile(n, roots)) return null;
    const ok = c => c !== n && !fragile(c, roots);
    let level = n.children || [];
    for (let d = 0; d < 3 && level.length; d++) {
      const hit = level.find(ok); if (hit) return {node: hit, rel: "子节点"};
      level = level.flatMap(c => c.children || []);
    }
    const up = ancestry(roots, n).slice(0, -1).reverse().slice(0, 3);
    const parent = up.find(ok);
    return parent ? {node: parent, rel: "父节点"} : null;
  }

  const center = r => r ? {x: Math.round((r.l + r.r) / 2), y: Math.round((r.t + r.b) / 2)} : null;

  const KINDS = [
    {id: "find", label: "查找节点"},
    {id: "click", label: "查找并点击"},
    {id: "exists", label: "等待出现"},
    {id: "xpath", label: "XPath 查找"},
    {id: "tap", label: "点击中心坐标"},
    {id: "all", label: "查找全部"},
    {id: "long_click", label: "查找并长按"},
  ];
  const NODE_IMPORT = "from xscript.android import node", ACTION_IMPORT = "from xscript.android import action";

  /** Code for one node: {imports: [lines], code}. `mode` 1 when the tree was dumped in full mode (Selector(1) sees it). */
  function querySelector(n, kind, mode, roots, criteria, options = {}) {
    let chain = kind === "xpath" ? "node.Selector(" + (mode ? "1, " : "") + "xpath=" + pyStr(options.xpath ?? nodeXPath(n, roots)) + ")" : selectorChain(n, "node", mode, roots, criteria);
    if (options.excludeSystem) chain += ".regex().package('^(?!com\\\\.android\\\\.systemui$).*').regex(False)";
    if (options.relation) {
      if (!["parent", "child", "brother"].includes(options.relation) || !Number.isFinite(options.index)) throw new Error("关系序号必须是有效数字");
      chain += "." + options.relation + "(" + String(options.index) + ")";
    }
    return chain;
  }
  function snippet(n, kind = "find", mode = 0, roots = null, criteria = null, options = {}) {
    if (kind === "tap") {
      const c = center(n.rect) || {x: 0, y: 0};
      return {imports: [ACTION_IMPORT], code: "action.click(" + c.x + ", " + c.y + ")  # " + label(n).replace(/\s+/g, " ").slice(0, 40)};
    }
    const note = (criteria && kind !== "xpath" ? criteria.some(c => c.enabled && c.field === "path") : fragile(n, roots)) ? FRAGILE : "";
    const chain = querySelector(n, kind, mode, roots, criteria, options);
    if (kind === "all") return {imports: [NODE_IMPORT], code: note + "hits = " + chain + ".find_all(timeout=0)"};
    if (kind === "long_click") return {imports: [NODE_IMPORT], code: note + chain + ".long_click().find(timeout=5)"};
    if (kind === "click") return {imports: [NODE_IMPORT], code: note + chain + ".click().find(timeout=5)"};
    if (kind === "exists") return {imports: [NODE_IMPORT], code: note + "if " + chain + ".exists(timeout=5):\n    pass"};
    return {imports: [NODE_IMPORT], code: note + "hit = " + chain + ".find(timeout=5)"};
  }
  const fullText = s => s.imports.join("\n") + "\n" + s.code;

  /** Snippet for POST /eval that runs the node's selector on the phone without acting on anything: every match (at most
   *  50) as [path, l, t, r, b]. null for 点击中心坐标, which has nothing to look up. */
  function tryCode(n, kind = "find", mode = 0, roots = null, criteria = null, options = {}) {
    if (kind === "tap") return null;
    const sel = querySelector(n, kind, mode, roots, criteria, options);
    const patterns = kind === "xpath" ? [] : (criteria || []).filter(c => c.enabled && c.op === "regex");
    const validate = patterns.length ? "\nimport re\n" + patterns.map(c => "re.compile(" + pyStr(c.value) + ", re.S)").join("\n") : "";
    return NODE_IMPORT + validate + "\n_hits = " + sel + ".find_all(timeout=0, limit=50)\n_result = [[h.path, h.left, h.top, h.right, h.bottom, h.id, h.text, h.desc, h.type] for h in _hits]";
  }

  /** The inserted snippet as a POST /eval body that really runs on the phone (find-and-click clicks, 点击中心坐标 taps)
   *  and answers in `_result`: what was found, whether the condition held, or that the tap was sent. */
  function runCode(n, kind = "find", mode = 0, roots = null, criteria = null, options = {}) {
    const s = snippet(n, kind, mode, roots, criteria, options);
    let code = s.code;
    if (kind === "tap") code += "\n_result = \"已点击坐标\"";
    else if (kind === "all") code += "\n_result = '找到 ' + str(len(hits)) + ' 个节点'";
    else if (kind === "exists") code = code.replace(/\n    pass$/, "\n    _result = \"条件成立：找到了\"\nelse:\n    _result = \"条件不成立：5 秒内没找到\"");
    else {
      if (["click", "long_click"].includes(kind)) code = code.replace(/^(node\.Selector)/m, "hit = $1");
      code += "\n_result = \"没找到（5 秒内）\" if hit is None else " + pyStr(kind === "click" ? "已点击 " : kind === "long_click" ? "已长按 " : "找到 ") + " + repr(hit)";
    }
    return s.imports.join("\n") + "\n" + code;
  }

  /** A picked node as remembered in 最近选过 (no children, nothing else of the tree). */
  const recentEntry = n => ({path: n.path || "", id: n.id || "", text: n.text || "", desc: n.desc || "", type: n.type || "", label: label(n)});
  const sameEntry = (a, b) => a.path === b.path && a.id === b.id && a.text === b.text && a.desc === b.desc && a.type === b.type;
  /** `list` with `entry` moved to the front, at most `max` long. */
  function pushRecent(list, entry, max = 8) { return [entry, ...(list || []).filter(e => !sameEntry(e, entry))].slice(0, max); }

  /** Find a remembered node in a freshly read tree: the same path with the same id / text / desc / type, else the one
   *  node with those values (it may have moved). null when it is gone or more than one node looks like it. */
  function findRecent(roots, entry) {
    const all = []; const walk = n => { all.push(n); for (const c of n.children || []) walk(c); }; for (const r of roots || []) walk(r);
    const same = n => (n.id || "") === entry.id && (n.text || "") === entry.text && (n.desc || "") === entry.desc && (n.type || "") === entry.type;
    const exact = all.find(n => n.path === entry.path && same(n)); if (exact) return exact;
    if (!entry.id && !entry.text && !entry.desc) return null;           // a bare layout node is only known by its path
    const like = all.filter(same);
    return like.length === 1 ? like[0] : null;
  }

  /** What a try found, for the picked node `n`: {text, ok, hits: [{path, rect}]}. `result` is /eval's JSON text. */
  function tryVerdict(result, n, custom = false) {
    let list = [];
    try { list = JSON.parse(result || "[]"); } catch (e) { list = []; }
    // the picked node itself: the same id / text / desc / type (it may have moved since the tree was read); the path only for nodes without them
    const me = h => h.vals && (n.id || n.text || n.desc) ? h.vals.join("\u0000") === [n.id || "", n.text || "", n.desc || "", n.type || ""].join("\u0000") : h.path === n.path;
    const hits = (Array.isArray(list) ? list : []).map(h => ({path: String(h[0]), rect: {l: h[1], t: h[2], r: h[3], b: h[4]}, vals: h.length > 5 ? h.slice(5, 9).map(v => v || "") : null}));
    for (const h of hits) { h.self = !!me(h); delete h.vals; }
    if (!hits.length) return {ok: false, hits, text: "试一下：没找到。界面可能变了，点「重新获取」再试"};
    const many = hits.length >= 50 ? "50 个及以上" : hits.length + " 个";
    if (custom) return {ok: true, hits, text: "在线测试：匹配 " + many + (hits.length > 1 ? "（.find 使用第一个）" : "")};
    if (!hits[0].self) return {ok: false, hits, text: "试一下：找到 " + many + "，第一个不是选中的节点（路径 " + hits[0].path + "）"};
    if (hits[0].path !== n.path) return {ok: true, hits, text: "试一下：找到 " + many + "，" + (hits.length > 1 ? "第一个" : "") + "是选中的节点，但它移动了（现在路径 " + hits[0].path + "），可点「重新获取」"};
    return {ok: true, hits, text: hits.length === 1 ? "试一下：找到 1 个，就是选中的节点" : "试一下：找到 " + many + "，第一个是选中的节点（.find 用第一个）"};
  }

  /** Where to add a missing import line: null when `text` already has it, else {at, text} (after the leading import block). */
  function importEdit(text, line) {
    const lines = String(text).split("\n");
    if (lines.some(l => l.trim() === line)) return null;
    const m = /^from\s+(\S+)\s+import\s+(\w+)$/.exec(line);
    if (m && lines.some(l => { const f = /^from\s+(\S+)\s+import\s+\(?([^#)]*)/.exec(l); return f && f[1] === m[1] && f[2].split(",").some(x => x.trim().split(/\s+/)[0] === m[2] && !/\sas\s/.test(x)); })) return null;
    let at = 0, offset = 0, end = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], t = l.trim();
      offset += l.length + 1;
      if (/^(import|from)\s/.test(l)) { at = offset; end = i + 1; continue; }
      if (t === "" || t.startsWith("#")) { if (!end) at = offset; continue; }
      break;
    }
    if (!end) at = 0;                                // no imports yet: put it on the first line
    return {at: Math.min(at, String(text).length), text: line + "\n"};
  }

  /** Attribute rows for the detail list. */
  function attrs(n) {
    const out = [], r = n.rect, c = center(r);
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "") out.push([k, String(v)]); };
    add("文字 text", n.text); add("描述 desc", n.desc); add("id", n.id); add("提示 hint", n.hint); add("类名 type", n.type); add("包名", n.package);
    add("路径 path", n.path);
    if (r) { add("范围", "[" + r.l + "," + r.t + "][" + r.r + "," + r.b + "]  " + (r.r - r.l) + "×" + (r.b - r.t)); add("中心", c.x + ", " + c.y); }
    const flags = ["clickable", "editable", "enabled", "visible"].filter(f => n[f] !== undefined).map(f => f + "=" + (n[f] ? "是" : "否"));
    add("属性", flags.join("  "));
    add("子节点", (n.children || []).length || n.childCount);
    for (const k of ["classPath", "depth", "drawingOrder", "inputType", "maxTextLength", "longClickable", "checkable", "checked", "focusable", "focused", "scrollable", "selected", "password"]) add(k, n[k]);
    return out;
  }

  /** Percent box over the screenshot for a rect in tree (device) pixels. */
  function boxStyle(r, w, h) {
    if (!r || !(w > 0) || !(h > 0)) return null;
    return {left: r.l / w * 100 + "%", top: r.t / h * 100 + "%", width: (r.r - r.l) / w * 100 + "%", height: (r.b - r.t) / h * 100 + "%"};
  }

  // opens the phone's accessibility settings (nonblocking; Python runs without the accessibility channel)
  const A11Y_CODE = "from xscript.android import permission\n_result = permission.request(permission.ACCESSIBILITY_SERVICE, 1)";

  /** The deadline covers response headers AND body; a reset can abort either phase. */
  async function deviceRequest(url, init = {}, type = "json", signal = null, timeout = 10000) {
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, {once:true});
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
    try {
      const response = await fetch(url, {...init, signal:controller.signal});
      let data;
      if (type === "blob") data = response.ok ? await response.blob() : null;
      else { try { data = await response.json(); } catch (e) { if (controller.signal.aborted) throw e; data = null; } }
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return {ok:response.ok, status:response.status, data};
    } catch (e) {
      if (timedOut) throw new Error("设备响应超时，请检查连接后重试");
      if (controller.signal.aborted) throw e;
      if (e instanceof TypeError) throw new Error("设备连接失败，请检查开发者地址和网络后重试");
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }

  const EditorNodes = {A11Y_CODE, FIELDS, defaultCriteria, criteriaError, hitTest, ancestry, rows, count, label, pyStr, xpathStr, selectorChain, nodeXPath, center, KINDS, snippet, fullText, runCode, recentEntry, pushRecent, findRecent, tryCode, tryVerdict, fragile, FRAGILE, stableAlternative, importEdit, attrs, boxStyle, shortType};
  EditorNodes.deviceRequest = deviceRequest;

  // ---- browser dock ----
  // ctx: {message(text, error), insertCode(code, imports) -> bool, onOpen()}
  function initNodes(ctx) {
    const $ = id => document.getElementById(id);
    const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const st = {tree: null, total: 0, selected: null, collapsed: new Set(), shotUrl: "", selector: "", token: 0, tryToken: 0, shotToken: 0, criteria: [], edited: false, loading: false};
    const requests = new Map(); st.stale = false; st.shotKind = "none"; st.hits = [];
    function stopRequests(...names) { for (const name of names) { requests.get(name)?.abort(); requests.delete(name); } }
    async function request(name, url, init = {}, type = "json", timeout = 10000) {
      stopRequests(name); const controller = new AbortController(); requests.set(name, controller);
      try { return await deviceRequest(url, init, type, controller.signal, timeout); }
      finally { if (requests.get(name) === controller) requests.delete(name); }
    }
    function screenshotState(kind, text) {
      st.shotKind = kind;
      const badge = $("node-shot-state"); if (badge) { badge.textContent = text; badge.classList.toggle("stale", kind === "stale" || kind === "none"); }
      if (kind !== "tree") { $("node-box").hidden = true; $("node-all-boxes")?.replaceChildren(); }
      hoverNode(null);
    }
    function showShot(blob, kind) {
      if (st.shotUrl) URL.revokeObjectURL(st.shotUrl);
      st.shotUrl = URL.createObjectURL(blob); $("node-shot").src = st.shotUrl; $("node-shot").hidden = false; $("node-shot-note").hidden = true;
      screenshotState(kind, (kind === "tree" ? "节点截图" : "测试截图") + " · " + new Date().toLocaleTimeString());
    }
    const info = (text, error = false) => { $("node-info").textContent = text; $("node-info").classList.toggle("error", error); };
    const takeBusy = busy => {
      const b = $("node-take"), label = $("node-take-label");
      b.disabled = busy; b.setAttribute("aria-busy", String(busy));
      if (label) label.textContent = busy ? "读取中…" : "获取节点";
    };
    const mode = () => st.tree ? st.tree.mode : ($("node-full").checked ? 1 : 0);
    const usesCriteria = () => !["xpath", "tap"].includes($("node-kind").value);
    const usesRelations = () => $("node-kind").value !== "tap";
    const criteria = () => st.edited && usesCriteria() ? st.criteria : null;
    let fieldLayout = "grouped", fieldOrder = FIELDS.map(f => f.key), dragField = "";
    try {
      fieldLayout = localStorage.getItem("xs-node-field-layout") === "custom" ? "custom" : "grouped";
      const saved = JSON.parse(localStorage.getItem("xs-node-field-order") || "[]");
      if (Array.isArray(saved)) fieldOrder = [...new Set([...saved.filter(key => fieldOrder.includes(key)), ...fieldOrder])];
    } catch { /* corrupt/off storage: use defaults */ }
    const options = () => ({xpath: $("node-xpath")?.value, relation: usesRelations() ? $("node-relation")?.value : "",
      index: $("node-relation-index")?.value === "" ? NaN : Number($("node-relation-index")?.value), excludeSystem: !!$("node-exclude-system")?.checked});
    function inputError() {
      if (criteria() && criteriaError(criteria())) return criteriaError(criteria());
      const o = options();
      if (o.relation && !Number.isFinite(o.index)) return "请输入有效的关系序号";
      if ($("node-kind").value === "xpath" && !o.xpath?.trim()) return "请输入 XPath";
      return "";
    }
    for (const k of KINDS) { const o = make("option", "", k.label); o.value = k.id; $("node-kind").append(o); }
    try { st.recent = JSON.parse(localStorage.getItem("xs-node-recent") || "[]").filter(e => e && typeof e.label === "string"); } catch (e) { st.recent = []; }
    function renderRecent() {
      const sel = $("node-recent"); sel.replaceChildren(make("option", "", st.recent.length ? "最近选过（" + st.recent.length + "）" : "最近选过"));
      sel.firstChild.value = "";
      st.recent.forEach((e, i) => { const o = make("option", "", e.label + " · " + shortType(e.type)); o.value = String(i); sel.append(o); });
      sel.disabled = !st.recent.length; sel.value = "";
    }
    /** Remember a node the user picked (tree click, screenshot click, 换成它); arrow keys do not count. */
    function remember(n) {
      if (!n) return;
      st.recent = pushRecent(st.recent, recentEntry(n));
      try { localStorage.setItem("xs-node-recent", JSON.stringify(st.recent)); } catch (e) { /* storage off */ }
      renderRecent();
    }
    try { const saved = localStorage.getItem("xs-node-kind"); if (KINDS.some(k => k.id === saved)) $("node-kind").value = saved; } catch (e) { /* storage off */ }

    function current() {
      if (!st.selected || st.loading || inputError()) return null;
      return snippet(st.selected, $("node-kind").value, mode(), st.tree && st.tree.roots, criteria(), options());
    }
    function resetCriteria() {
      st.criteria = st.selected ? defaultCriteria(st.selected, st.tree && st.tree.roots) : [];
      st.edited = false; renderCriteria();
      if ($("node-xpath")) $("node-xpath").value = st.selected ? nodeXPath(st.selected, st.tree && st.tree.roots) : "";
      if ($("node-relation")) { $("node-relation").value = ""; $("node-relation-index").value = "1"; }
    }
    function renderCriteria() {
      const box = $("node-conditions"); box.replaceChildren();
      const group = c => { const f = FIELDS.find(f => f.key === c.field); return f.flag ? 1 : f.number || ["path", "classPath"].includes(f.key) ? 2 : 0; };
      const ordered = st.criteria.slice().sort((a, b) => fieldLayout === "custom" ? fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field) : group(a) - group(b));
      let lastGroup = -1;
      for (const c of ordered) {
        if (fieldLayout === "grouped" && group(c) !== lastGroup) { lastGroup = group(c); box.append(make("h3", "node-condition-section", ["基础属性", "状态属性", "结构属性"][lastGroup])); }
        const f = FIELDS.find(f => f.key === c.field), row = make("div", "node-condition"); row.dataset.field = f.key;
        if (fieldLayout === "custom") {
          row.classList.add("custom");
          const handle = make("span", "node-drag", "⠿"); handle.draggable = true; handle.tabIndex = 0; handle.setAttribute("role", "button");
          handle.setAttribute("aria-label", "移动" + f.label + "条件（Alt + 上下键）"); handle.title = "拖动排序，也可按 Alt + 上下键";
          handle.addEventListener("dragstart", e => { dragField = f.key; e.dataTransfer.setData("text/plain", f.key); e.dataTransfer.effectAllowed = "move"; });
          handle.addEventListener("dragend", () => { dragField = ""; box.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target")); });
          row.addEventListener("dragover", e => { if (dragField) { e.preventDefault(); row.classList.add("drop-target"); } });
          row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
          row.addEventListener("drop", e => { if (!dragField) return; e.preventDefault(); moveField(dragField, f.key); dragField = ""; });
          handle.addEventListener("keydown", e => { if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); const target = fieldOrder[fieldOrder.indexOf(f.key) + (e.key === "ArrowDown" ? 1 : -1)]; if (target) moveField(f.key, target); } });
          row.append(handle);
        }
        const label = make("label"), enabled = make("input"); enabled.type = "checkbox"; enabled.checked = c.enabled;
        enabled.setAttribute("aria-label", "使用" + f.label + "条件"); label.append(enabled, document.createTextNode(f.label));
        const op = make("select"); op.setAttribute("aria-label", f.label + "匹配方式");
        for (const [value, text] of (f.flag || f.number ? [["exact", "等于"]] : [["exact", "精确"], ["contains", "包含"], ["regex", "正则"]])) {
          const o = make("option", "", text); o.value = value; op.append(o);
        }
        op.value = c.op; op.disabled = !c.enabled || f.flag || f.number;
        const value = make(f.flag ? "select" : "input"); value.setAttribute("aria-label", f.label + "条件值");
        if (f.flag) for (const [v, text] of [["true", "是"], ["false", "否"]]) { const o = make("option", "", text); o.value = v; value.append(o); }
        else { value.type = f.number ? "number" : "text"; if (f.number) { value.min = "0"; value.step = "1"; } value.autocomplete = "off"; value.spellcheck = false; }
        value.value = String(c.value); value.disabled = !c.enabled;
        const changed = () => {
          c.enabled = enabled.checked; c.op = op.value; c.value = f.flag ? value.value === "true" : f.number ? (value.value === "" ? NaN : Number(value.value)) : value.value;
          value.disabled = !c.enabled; op.disabled = !c.enabled || f.flag || f.number;
          st.edited = true; renderDetail();
        };
        enabled.addEventListener("change", changed); op.addEventListener("change", changed);
        value.addEventListener(f.flag ? "change" : "input", changed);
        row.append(label, op, value); box.append(row);
      }
      if ($("node-layout-grouped")) {
        $("node-layout-grouped").setAttribute("aria-pressed", String(fieldLayout === "grouped"));
        $("node-layout-custom").setAttribute("aria-pressed", String(fieldLayout === "custom"));
        $("node-layout-reset").hidden = fieldLayout !== "custom";
      }
    }
    function moveField(from, target) {
      const at = fieldOrder.indexOf(from), to = fieldOrder.indexOf(target); if (at < 0 || to < 0) return;
      fieldOrder.splice(at, 1); fieldOrder.splice(to, 0, from);
      try { localStorage.setItem("xs-node-field-order", JSON.stringify(fieldOrder)); } catch {}
      renderCriteria();
      [...$("node-conditions").querySelectorAll(".node-condition")].find(row => row.dataset.field === from)?.querySelector(".node-drag")?.focus();
    }
    function drawSelection() {
      const n = st.selected, box = $("node-box"), css = n && st.tree && boxStyle(n.rect, st.tree.width, st.tree.height);
      box.hidden = !css || $("node-shot").hidden || st.shotKind !== "tree";
      if (css) Object.assign(box.style, css);
      drawOutlines();
    }
    function drawOutlines() {
      if (!$("node-all-boxes")) return;
      $("node-all-boxes").replaceChildren();
      if (!st.tree || !$("node-outlines").checked || $("node-shot").hidden || st.shotKind !== "tree") return;
      for (const {node} of rows(st.tree.roots, {excludeSystem: options().excludeSystem}).rows) {
        const css = boxStyle(node.rect, st.tree.width, st.tree.height); if (!css) continue;
        const b = make("div", "node-outline"); Object.assign(b.style, css); $("node-all-boxes").append(b);
      }
    }
    function renderDetail() {
      clearTry();
      $("node-tree").setAttribute("aria-busy", String(st.loading));
      for (const id of ["node-kind", "node-xpath", "node-relation", "node-relation-index"]) if ($(id)) $(id).disabled = st.loading;
      const n = st.selected, dl = $("node-attrs"); dl.replaceChildren();
      if (!n) { dl.append(make("p", "node-empty", st.tree ? "在树里或截图上点一个节点" : "")); }
      else for (const [k, v] of attrs(n)) dl.append(make("dt", "", k), make("dd", "", v));
      const s = current();
      $("node-code").value = s ? fullText(s) : "";
      $("node-copy").disabled = $("node-insert").disabled = !s;
      st.selector = s && n && $("node-kind").value !== "tap" ? querySelector(n, $("node-kind").value, mode(), st.tree && st.tree.roots, criteria(), options()) : "";
      if ($("node-copy-selector")) $("node-copy-selector").disabled = !st.selector;
      $("node-criteria").hidden = !n || !usesCriteria();
      $("node-criteria").disabled = st.loading;
      $("node-criteria-note").hidden = !n || usesCriteria();
      $("node-criteria-note").textContent = $("node-kind").value === "xpath" ? "XPath 按所选节点生成，不使用下方筛选条件；仍可叠加关系定位。" : "坐标代码使用所选节点的中心点，不支持查找测试。";
      $("node-condition-error").textContent = n ? inputError() : "";
      if ($("node-xpath-wrap")) $("node-xpath-wrap").hidden = !n || $("node-kind").value !== "xpath";
      if ($("node-relations")) $("node-relations").hidden = !n || !usesRelations();
      if ($("node-condition-layout")) $("node-condition-layout").hidden = !n || !usesCriteria();
      if ($("node-selected-name")) $("node-selected-name").textContent = n ? label(n) : "选择一个节点开始";
      $("node-reset").disabled = !n || st.loading;
      const alt = n && st.tree ? stableAlternative(n, st.tree.roots) : null;
      $("node-alt").hidden = !alt; st.alt = alt && alt.node;
      if (alt) $("node-alt-text").textContent = "更稳的选择：" + alt.rel + "「" + label(alt.node) + "」，它的 id、文字或描述在界面上唯一";
      $("node-try").disabled = !s || st.stale || $("node-kind").value === "tap";
      $("node-run").hidden = true;
      const trail = $("node-breadcrumb");
      if (trail) {
        trail.replaceChildren();
        if (n && st.tree) for (const parent of ancestry(st.tree.roots, n)) {
          const button = make("button", "", label(parent)); button.type = "button"; button.title = parent.path + " · " + (parent.type || "");
          button.setAttribute("aria-current", String(parent === n)); button.disabled = st.loading;
          button.addEventListener("click", () => { remember(parent); select(parent, {reveal:true, focus:true}); }); trail.append(button);
        }
      }
      drawSelection();
    }
    function renderTree({resetScroll = false} = {}) {
      const box = $("node-tree"), keepScroll = box.scrollTop; box.replaceChildren();
      if (!st.tree) {
        box.append(make("p", "empty-hint", "点击「获取节点」读取手机界面，或从上方切换到完整树。"));
        if ($("node-tree-count")) $("node-tree-count").textContent = "0";
        return;
      }
      const {rows: list, truncated} = rows(st.tree.roots, {collapsed: st.collapsed, filter: $("node-filter").value, excludeSystem: options().excludeSystem, paths: $("node-only-matches")?.checked ? st.matchPaths : null});
      const total = st.total || count(st.tree.roots);
      if ($("node-tree-count")) $("node-tree-count").textContent = list.length === total ? String(total) : list.length + " / " + total;
      for (const r of list) {
        const row = make("div", "node-row" + (r.match ? " match" : "")); row.setAttribute("role", "treeitem"); row.tabIndex = -1;
        row.dataset.path = key(r.node); row.setAttribute("aria-level", String(r.depth + 1)); row.style.paddingLeft = 4 + r.depth * 12 + "px";
        row.title = [label(r.node), r.node.type, r.node.path].filter(Boolean).join("\n");
        if (st.matchPaths?.has(key(r.node))) row.classList.add("query-hit");
        if (r.hasChildren) row.setAttribute("aria-expanded", String(r.expanded));
        row.setAttribute("aria-selected", String(r.node === st.selected));
        const tw = make("span", "node-twisty", r.hasChildren ? (r.expanded ? "▾" : "▸") : ""); tw.setAttribute("aria-hidden", "true");
        row.append(tw, make("span", "node-label", label(r.node)), make("span", "node-type", shortType(r.node.type)));
        if (r.node.clickable) row.append(make("span", "node-tag", "可点"));
        row._node = r.node;
        box.append(row);
      }
      if (!list.length) box.append(make("p", "node-empty", $("node-filter").value ? "没有匹配的节点" : $("node-only-matches")?.checked ? "本次匹配不在当前节点快照中，取消筛选或重新获取" : "没有节点"));
      if (truncated) box.append(make("p", "node-empty", "节点太多，只显示前 2000 个；可用筛选缩小范围"));
      const sel = box.querySelector('[aria-selected="true"]') || box.querySelector(".node-row");
      if (sel) sel.tabIndex = 0;
      box.scrollTop = resetScroll ? 0 : keepScroll;
    }
    function select(n, {reveal = false, focus = false} = {}) {
      if (st.loading) return;
      st.selected = n;
      resetCriteria();
      if (n && reveal) for (const a of ancestry(st.tree.roots, n)) if (a !== n) st.collapsed.delete(key(a));
      renderTree(); renderDetail();
      const row = $("node-tree").querySelector('[aria-selected="true"]');
      if (row && (reveal || focus)) { row.scrollIntoView({block: "nearest"}); if (focus) row.focus(); }
    }

    function hoverNode(n) {
      const box = $("node-hover-box"); if (!box) return;
      const css = n && st.tree && st.shotKind === "tree" && !$("node-shot").hidden && boxStyle(n.rect, st.tree.width, st.tree.height);
      box.hidden = !css; if (css) Object.assign(box.style, css);
      if ($("node-hover-note")) $("node-hover-note").textContent = n ? label(n) + " · " + (n.type || "") + " · 路径 " + n.path : "悬停预览节点，点击选取；测试截图可点选匹配结果。";
    }
    function locateHit(hit) {
      for (const h of st.hits) { h.box?.classList.toggle("focused", h === hit); h.button?.setAttribute("aria-current", String(h === hit)); }
      if (hit.box) hit.box.scrollIntoView({block:"nearest", inline:"nearest"});
      const n = hit.snapshot;
      if (!n) { info("匹配节点不在当前树快照中，请重新获取节点；已保留当前测试条件", true); return; }
      // Reveal a matching snapshot node even if a search or folded ancestor currently hides it.
      $("node-filter").value = "";
      for (const p of ancestry(st.tree.roots, n)) st.collapsed.delete(key(p));
      renderTree();
      const row = [...$("node-tree").querySelectorAll(".node-row")].find(r => r.dataset.path === n.path);
      if (row) { row.classList.add("located"); row.scrollIntoView({block:"nearest"}); row.focus({preventScroll:true}); }
      else info("节点未显示，请缩小树范围后再定位", true);
    }

    function clearTry() {
      if (st.shotKind === "test" && st.hits.length) screenshotState("stale", "保留的测试截图，获取节点后可继续选点");
      st.tryToken += 1;
      stopRequests("test", "test-shot", "run"); st.hits = [];
      if ($("node-cancel")) $("node-cancel").hidden = true;
      $("node-try-result").textContent = ""; $("node-try-result").classList.remove("error", "ok");
      $("node-hits").replaceChildren();
      $("node-matches").replaceChildren();
      if ($("node-match-count")) $("node-match-count").textContent = "";
      $("node-run").disabled = false;
      st.matchPaths = null;
      if ($("node-only-matches")) {
        const had = $("node-only-matches").checked;
        $("node-only-matches").checked = false; $("node-result-filter").hidden = true;
        if (had) renderTree();
        else $("node-tree").querySelectorAll(".query-hit").forEach(row => row.classList.remove("query-hit"));
      }
    }
    /** Run the selector on the phone (POST /eval, find_all only: nothing is clicked) and box what it finds. */
    async function tryIt() {
      const n = st.selected, code = current() && tryCode(n, $("node-kind").value, mode(), st.tree && st.tree.roots, criteria(), options());
      if (!code || st.stale) return;
      clearTry();
      ++st.shotToken;
      const custom = !!criteria() || !!options().relation || $("node-kind").value === "xpath";
      const token = st.tryToken, out = $("node-try-result");
      const started = performance.now();
      if ($("node-cancel")) $("node-cancel").hidden = false;
      $("node-try").disabled = true; out.textContent = "试一下：在手机上查找…";
      $("node-run").disabled = true;
      // a screenshot taken now, so the boxes are drawn over what the phone shows at try time, not when the tree was read
      const fresh = request("test-shot", "/screen?t=" + Date.now(), {cache: "no-store", headers: {"X-XScript-Client": "tools"}}, "blob", 6000).then(r => r.ok ? r.data : null).catch(() => null);
      try {
        const r = await request("test", "/eval", {method: "POST", cache: "no-store", headers: {"Content-Type": "application/json", "X-XScript-Client": "tools"}, body: JSON.stringify({code, timeout_ms: 5000})});
        if (r.status === 401) { location.href = "/pair?next=" + encodeURIComponent(location.pathname + location.search); return; }
        const data = r.data;
        if (token !== st.tryToken) return;
        if (!r.ok || !data || !data.ok) throw new Error("试一下失败：" + ((data && (data.error || "").trim().split("\n").pop()) || "HTTP " + r.status));
        const v = tryVerdict(data.result, n, custom);
        const elapsed = ((performance.now() - started) / 1000).toFixed(2) + " 秒";
        out.textContent = "查找完成：" + v.hits.length + " 个匹配 · " + elapsed + " · 正在更新截图…";
        const blob = await fresh; if (token !== st.tryToken) return;
        if (blob) showShot(blob, "test");
        else screenshotState("stale", "截图未刷新，暂不标注结果");
        out.textContent = v.text + " · " + elapsed + (blob ? " · 截图已刷新" : " · 截图未刷新，结果见列表"); out.classList.add(v.ok ? "ok" : "error");
        const rawHits = JSON.parse(data.result || "[]");
        for (const [i, h] of v.hits.entries()) {
          const values = rawHits[i] || [], name = values[6] || values[7] || values[5] || "";
          const entry = {path:h.path, id:values[5] || "", text:values[6] || "", desc:values[7] || "", type:values[8] || ""};
          h.snapshot = st.tree && (values.length > 5 ? findRecent(st.tree.roots, entry) : rows(st.tree.roots, {limit:Infinity}).rows.find(r => key(r.node) === h.path)?.node);
          const item = make("li"), button = make("button", "node-match-link", (name ? name + " · " : "") + "路径 " + h.path + (h.self ? " · 所选节点" : ""));
          button.type = "button"; button.title = "定位到树中的匹配项，不更改筛选条件";
          button.addEventListener("click", () => locateHit(h)); h.button = button;
          item.append(button); $("node-matches").append(item);
        }
        st.hits = v.hits;
        st.matchPaths = new Set(v.hits.filter(h => h.snapshot).map(h => h.snapshot.path));
        if ($("node-match-count")) $("node-match-count").textContent = v.hits.length ? (v.hits.length >= 50 ? "50+" : String(v.hits.length)) + " 个" : "";
        if ($("node-result-filter")) { $("node-result-filter").hidden = !v.hits.length; $("node-only-matches").checked = !!v.hits.length; }
        renderTree();
        if (blob && st.tree && !$("node-shot").hidden) for (const h of v.hits) {
          const css = boxStyle(h.rect, st.tree.width, st.tree.height); if (!css) continue;
          const b = make("div", "node-hit" + (custom ? " query-match" : "") + (h.self ? " self" : "")); b.title = h.path; Object.assign(b.style, css); $("node-hits").append(b); h.box = b;
        }
      } catch (e) { if (token === st.tryToken) { out.textContent = e.message; out.classList.add("error"); } }
      finally { if (token === st.tryToken) { $("node-try").disabled = false; $("node-run").disabled = false; if ($("node-cancel")) $("node-cancel").hidden = true; } }
    }

    /** Run the snippet that was just inserted, for real (POST /eval): find-and-click clicks, 点击中心坐标 taps. */
    async function runIt() {
      const n = st.selected; if (!current() || st.stale) return;
      const code = runCode(n, $("node-kind").value, mode(), st.tree && st.tree.roots, criteria(), options());
      clearTry();
      const token = st.tryToken, out = $("node-try-result");
      $("node-run").disabled = true; out.textContent = "在手机上运行…";
      $("node-try").disabled = true;
      try {
        const r = await request("run", "/eval", {method: "POST", cache: "no-store", headers: {"Content-Type": "application/json", "X-XScript-Client": "tools"}, body: JSON.stringify({code, timeout_ms: 8000})}, "json", 12000);
        if (r.status === 401) { location.href = "/pair?next=" + encodeURIComponent(location.pathname + location.search); return; }
        const data = r.data;
        if (token !== st.tryToken) return;
        if (!r.ok || !data || !data.ok) throw new Error("运行失败：" + ((data && (data.error || "").trim().split("\n").pop()) || "HTTP " + r.status));
        const text = String(data.result || "");
        out.textContent = "运行结果：" + text; out.classList.add(/^(没找到|条件不成立)/.test(text) ? "error" : "ok");
      } catch (e) { if (token === st.tryToken) { out.textContent = e.message; out.classList.add("error"); } }
      finally { if (token === st.tryToken) { $("node-run").disabled = false; $("node-try").disabled = $("node-kind").value === "tap"; } }
    }

    async function take() {
      const token = ++st.token, requestedMode = $("node-full").checked ? 1 : 0;
      const previous = st.selected && recentEntry(st.selected), draft = {criteria:st.criteria.map(c => ({...c})), edited:st.edited, ...options()};
      const customXPath = st.selected && draft.xpath !== nodeXPath(st.selected, st.tree?.roots);
      stopRequests("tree-shot"); screenshotState("stale", "正在获取新节点…");
      ++st.shotToken; st.loading = true; renderDetail();
      takeBusy(true); info("读取节点…");
      try {
        const r = await request("tree", "/ui-tree?mode=" + requestedMode + "&t=" + Date.now(), {cache: "no-store", headers: {"X-XScript-Client": "tools"}});
        if (r.status === 401) { location.href = "/pair?next=" + encodeURIComponent(location.pathname + location.search); return; }
        const data = r.data;
        const noChannel = !r.ok && /no_channel/.test(data && data.error || "");
        if (token === st.token) $("node-a11y").hidden = !noChannel;
        if (!r.ok) throw new Error(noChannel || /no_channel/.test(data && data.error || "") ? "读不到节点：请在手机上开启 XScript 的无障碍服务（或授予 Root）后再试" : "读取节点失败（HTTP " + r.status + (data && data.error ? "：" + data.error : "") + "）");
        if (!data || !Array.isArray(data.roots)) throw new Error("设备返回的节点数据无效，请重新获取");
        if (token !== st.token) return;
        // keep the same control selected, not whatever now sits at its old path (a scrolled list shifts every row)
        st.tree = {width: Number(data.width) || 0, height: Number(data.height) || 0, roots: Array.isArray(data.roots) ? data.roots : [], mode: requestedMode};
        st.total = count(st.tree.roots);
        st.loading = false; st.stale = false;
        st.selected = null;
        if (previous) st.selected = findRecent(st.tree.roots, previous);
        resetCriteria();
        if (st.selected) {
          if (draft.edited) { st.criteria = draft.criteria; st.edited = true; renderCriteria(); }
          if (customXPath && $("node-xpath")) $("node-xpath").value = draft.xpath;
          if ($("node-relation")) { $("node-relation").value = draft.relation || ""; $("node-relation-index").value = String(draft.index); }
        }
        renderTree(); renderDetail();
        info(count(st.tree.roots) + " 个节点 · " + st.tree.width + "×" + st.tree.height + " · " + (previous && !st.selected ? "之前选中的「" + previous.label + "」不在当前界面上" : st.selected && draft.edited ? "已更新节点，保留手动匹配条件" : "点截图或树选中节点"));
        shot(token);
      } catch (e) { if (token === st.token) {
        st.loading = false; st.stale = true;
        if (st.tree) $("node-full").checked = !!st.tree.mode;
        info(e.message + (st.tree ? " · 已保留上次节点和条件，请重新获取后测试" : ""), true);
        screenshotState("stale", "旧截图，请重新获取"); renderDetail();
      } }
      finally { if (token === st.token) { st.loading = false; takeBusy(false); document.dispatchEvent(new Event("nodes:snapshot")); } }
    }
    async function shot(token) {
      const img = $("node-shot"), shotToken = ++st.shotToken;
      try {
        const r = await request("tree-shot", "/screen?t=" + Date.now(), {cache: "no-store", headers: {"X-XScript-Client": "tools"}}, "blob", 6000);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const blob = r.data; if (token !== st.token || shotToken !== st.shotToken) return;
        showShot(blob, "tree");
      } catch (e) {
        if (token !== st.token || shotToken !== st.shotToken) return;
        img.hidden = true; $("node-shot-note").hidden = false;
        screenshotState("none", "截图不可用，仍可从树中选择");
      }
      drawSelection();
    }

    function setOpen(open) {
      $("node-panel").hidden = !open; $("node-toggle").setAttribute("aria-pressed", String(open));
      if (open) { if (ctx.onOpen) ctx.onOpen(); if (!st.tree) take(); }
      else { ++st.token; ++st.shotToken; stopRequests(...requests.keys()); st.loading = false; takeBusy(false); renderDetail(); }
    }
    $("node-toggle").addEventListener("click", () => setOpen($("node-panel").hidden));
    $("node-close").addEventListener("click", () => setOpen(false));
    $("node-take").addEventListener("click", take);
    $("node-a11y").addEventListener("click", async () => {
      $("node-a11y").disabled = true; info("正在手机上打开无障碍设置…");
      try {
        const r = await request("permission", "/eval", {method: "POST", cache: "no-store", headers: {"Content-Type": "application/json", "X-XScript-Client": "tools"}, body: JSON.stringify({code: A11Y_CODE, timeout_ms: 5000})});
        if (r.status === 401) { location.href = "/pair?next=" + encodeURIComponent(location.pathname + location.search); return; }
        const data = r.data;
        if (!r.ok || !data || !data.ok) throw new Error("打开失败：" + ((data && (data.error || "").trim().split("\n").pop()) || "HTTP " + r.status) + "，请在手机的 设置 → 无障碍 里开启 XScript");
        info(String(data.result) === "1" ? "无障碍服务已开启，点「重新获取」" : "已在手机上打开无障碍设置：找到 XScript 并开启，然后点「重新获取」");
      } catch (e) { info(e.message, true); }
      finally { $("node-a11y").disabled = false; }
    });
    $("node-try").addEventListener("click", tryIt);
    $("node-cancel")?.addEventListener("click", () => { renderDetail(); $("node-try-result").textContent = "已停止等待，匹配条件已保留；设备上的只读查询可能仍在结束中"; });
    $("node-reset").addEventListener("click", () => { resetCriteria(); renderDetail(); $("node-try-result").textContent = "已重置测试，恢复所选节点的默认条件"; });
    $("node-outlines")?.addEventListener("change", drawOutlines);
    $("node-only-matches")?.addEventListener("change", () => renderTree({resetScroll: true}));
    for (const layout of ["grouped", "custom"]) $("node-layout-" + layout)?.addEventListener("click", () => {
      fieldLayout = layout; try { localStorage.setItem("xs-node-field-layout", layout); } catch {} renderCriteria();
    });
    $("node-layout-reset")?.addEventListener("click", () => { fieldOrder = FIELDS.map(f => f.key); try { localStorage.removeItem("xs-node-field-order"); } catch {} renderCriteria(); });
    $("node-expand")?.addEventListener("click", () => { st.collapsed.clear(); renderTree({resetScroll: true}); });
    $("node-collapse")?.addEventListener("click", () => { st.collapsed = new Set(rows(st.tree?.roots).rows.map(r => key(r.node))); renderTree({resetScroll: true}); });
    $("node-exclude-system")?.addEventListener("change", () => {
      if (st.selected?.package === "com.android.systemui" && options().excludeSystem) select(null);
      renderTree({resetScroll: true}); renderDetail();
    });
    $("node-xpath")?.addEventListener("input", renderDetail);
    $("node-relation")?.addEventListener("change", renderDetail);
    $("node-relation-index")?.addEventListener("input", renderDetail);
    $("node-filter").addEventListener("keydown", e => { if (e.key === "Escape") { $("node-filter").value = ""; renderTree(); } });
    $("node-alt-use").addEventListener("click", () => { if (st.alt) { remember(st.alt); select(st.alt, {reveal: true, focus: true}); } });
    $("node-recent").addEventListener("change", () => {
      const entry = st.recent[Number($("node-recent").value)]; $("node-recent").value = "";
      if (!entry || !st.tree) return;
      const n = findRecent(st.tree.roots, entry);
      if (!n) { info("当前界面上找不到「" + entry.label + "」：先在手机上回到那个界面，再点「重新获取」", true); return; }
      remember(n); select(n, {reveal: true, focus: true});
      info("已选中最近的「" + entry.label + "」（路径 " + n.path + "）");
    });
    $("node-full").addEventListener("change", take);
    $("node-filter").addEventListener("input", () => renderTree({resetScroll: true}));
    $("node-kind").addEventListener("change", () => { try { localStorage.setItem("xs-node-kind", $("node-kind").value); } catch (e) { /* storage off */ } renderDetail(); });
    $("node-copy").addEventListener("click", () => { const s = current(); if (s) XS.copy(fullText(s), "已复制代码"); });
    $("node-copy-selector")?.addEventListener("click", () => { if (st.selector) XS.copy(st.selector, "已复制选择器"); });
    $("node-insert").addEventListener("click", async () => {
      const s = current(), token = st.tryToken; if (!s || !await ctx.insertCode(s.code, s.imports)) return;
      if (token !== st.tryToken) return;
      ctx.message("已插入节点代码：" + label(st.selected));
      // offer to run what was just inserted; it acts on the phone for the click kinds, so the button says so
      const acts = ["click", "tap", "long_click"].includes($("node-kind").value);
      $("node-run").textContent = acts ? "在手机上运行（会操作设备）" : "在手机上运行";
      $("node-run").hidden = !!st.stale; $("node-run").disabled = false;
    });
    $("node-run").addEventListener("click", runIt);
    $("node-tree").addEventListener("click", e => {
      const row = e.target.closest(".node-row"); if (!row) return;
      const n = row._node;
      if (e.target.closest(".node-twisty") && (n.children || []).length) { const k = key(n); if (st.collapsed.has(k)) st.collapsed.delete(k); else st.collapsed.add(k); renderTree(); return; }
      remember(n); select(n, {focus: true});
    });
    $("node-tree").addEventListener("pointerover", e => hoverNode(e.target.closest(".node-row")?._node || null));
    $("node-tree").addEventListener("pointerleave", () => hoverNode(null));
    $("node-tree").addEventListener("keydown", e => {
      const list = [...$("node-tree").querySelectorAll(".node-row")], i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const n = list[i]._node, kids = (n.children || []).length, k = key(n);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; select(next._node, {focus: true}); }
      else if (e.key === "ArrowRight" && kids && st.collapsed.has(k)) { e.preventDefault(); st.collapsed.delete(k); select(n, {focus: true}); }
      else if (e.key === "ArrowLeft" && kids && !st.collapsed.has(k) && !$("node-filter").value) { e.preventDefault(); st.collapsed.add(k); select(n, {focus: true}); }
      else if (e.key === "Enter") { e.preventDefault(); $("node-insert").click(); }
    });
    function shotPoint(e) {
      if (!st.tree) return null;
      const rect = e.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
      return {x:Math.floor((e.clientX - rect.left) * st.tree.width / rect.width), y:Math.floor((e.clientY - rect.top) * st.tree.height / rect.height)};
    }
    $("node-shot").addEventListener("pointermove", e => {
      const p = shotPoint(e); if (!p || st.shotKind !== "tree") return;
      hoverNode(hitTest(st.tree.roots, p.x, p.y, options().excludeSystem));
    });
    $("node-shot").addEventListener("pointerleave", () => hoverNode(null));
    $("node-shot").addEventListener("click", e => {
      if (!st.tree) return;
      const point = shotPoint(e); if (!point) return; const {x, y} = point;
      if (st.shotKind === "test") {
        const hit = hitTest(st.hits, x, y);
        if (hit) locateHit(hit); else info("这是测试截图，点匹配框可定位结果；继续选取其他节点请先获取节点");
        return;
      }
      if (st.shotKind !== "tree") { info("当前截图与节点未同步，请先获取节点再从画面选取", true); return; }
      const hit = hitTest(st.tree.roots, x, y, options().excludeSystem);
      if (hit) { $("node-filter").value = ""; remember(hit); select(hit, {reveal: true}); } else info("x=" + x + "，y=" + y + " 处没有节点");
    });
    document.addEventListener("keydown", e => {
      if (document.querySelector(".xs-dialog-backdrop")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!$("node-try").disabled) $("node-try").click();
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault(); $("node-filter").focus(); $("node-filter").select();
      }
    });
    document.addEventListener("click", e => {
      const help = document.querySelector(".node-help");
      if (help?.open && !e.target.closest(".node-help")) help.open = false;
    });
    window.addEventListener("pagehide", () => {
      ++st.token; ++st.shotToken; stopRequests(...requests.keys());
      st.stale = st.stale || st.loading; st.loading = false; takeBusy(false); renderDetail();
    });
    renderRecent(); renderDetail();
    return {take, open: () => setOpen(true), close: () => setOpen(false), state: () => st};
  }
  EditorNodes.initNodes = initNodes;

  if (typeof module !== "undefined" && module.exports) module.exports = {EditorNodes};
  else root.EditorNodes = EditorNodes;
})(typeof window !== "undefined" ? window : globalThis);
