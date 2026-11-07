"use strict";
(() => {
  const token = new URLSearchParams(location.search).get("editor");
  const message = (text, error = false) => { const e = document.getElementById("node-message"); e.textContent = text; e.classList.toggle("error", error); };
  document.getElementById("node-back").onclick = () => { if (opener && !opener.closed) opener.focus(); else location.href = "/tools/ui/editor.html"; };
  document.getElementById("node-insert").hidden = !opener || !token;
  const inspector = EditorNodes.initNodes({message, async insertCode(code, imports) {
    if (!opener || opener.closed) { message("IDE 已关闭，请复制代码，或从 IDE 重新打开节点页", true); return false; }
    const id = String(Date.now()) + Math.random();
    const ok = await new Promise(resolve => {
      const finish = value => { clearTimeout(timer); removeEventListener("message", receive); resolve(value); };
      const receive = e => { if (e.origin === location.origin && e.source === opener && e.data?.type === "xscript:node-inserted" && e.data.id === id) finish(e.data.ok); };
      const timer = setTimeout(() => finish(false), 3000);
      addEventListener("message", receive);
      opener.postMessage({type:"xscript:insert-node", token, id, code, imports}, location.origin);
    });
    message(ok ? "已插入 IDE 光标处，切回后保存即可" : "未插入：请在原 IDE 中打开 .py 文件再试", !ok);
    return ok;
  }});
  if (new URLSearchParams(location.search).get("mode") === "1") document.getElementById("node-full").checked = true;
  inspector.open();
  let statusRequest = null;
  async function refreshStatus() {
    statusRequest?.abort(); const controller = new AbortController(); statusRequest = controller;
    try {
      const r = await EditorNodes.deviceRequest("/status", {headers:{"X-XScript-Client":"tools"},cache:"no-store"}, "json", controller.signal, 5000);
      if (!r.ok || !r.data) throw new Error("status");
      if (controller.signal.aborted) return; const s = r.data, channel = document.getElementById("node-channel");
      const ready = s.channel === "accessibility" || s.channel === "root";
      channel.textContent = "通道：" + (s.channel === "accessibility" ? "无障碍" : s.channel === "root" ? "Root" : "未就绪") + " · " + (s.model || "设备");
      channel.dataset.state = ready ? "ok" : "off";
    } catch { if (!controller.signal.aborted) { const channel = document.getElementById("node-channel"); channel.textContent = "设备未连接，获取节点可重试"; channel.dataset.state = "off"; } }
  }
  document.addEventListener("nodes:snapshot", refreshStatus);
  refreshStatus();
  addEventListener("pagehide", () => statusRequest?.abort());
  const frame = document.querySelector(".node-frame"), screenScroll = document.querySelector(".node-screen-scroll"), shot = document.getElementById("node-shot");
  const zoom = document.getElementById("node-zoom"); let fit = true;
  function applyZoom() {
    const available = Math.max(1, screenScroll.clientWidth - 24), height = Math.max(1, screenScroll.clientHeight - 24);
    const width = fit && shot.naturalWidth ? Math.min(available, height * shot.naturalWidth / shot.naturalHeight) : available * Number(zoom.value) / 100;
    frame.style.width = width + "px"; frame.classList.toggle("fit", fit);
    document.getElementById("node-zoom-value").textContent = fit ? "适应" : zoom.value + "%";
    document.getElementById("node-fit").setAttribute("aria-pressed", String(fit));
  }
  zoom.addEventListener("input", () => { fit = false; applyZoom(); });
  document.getElementById("node-fit").addEventListener("click", () => { fit = true; screenScroll.scrollTo(0, 0); applyZoom(); });
  shot.addEventListener("load", applyZoom);
  new ResizeObserver(applyZoom).observe(screenScroll); applyZoom();
  const font = document.getElementById("node-font");
  try { font.value = localStorage.getItem("xs-node-font") || "13"; } catch {}
  const setFont = () => { document.getElementById("node-panel").style.setProperty("--node-font", font.value + "px"); try { localStorage.setItem("xs-node-font", font.value); } catch {} };
  font.addEventListener("input", setFont); setFont();
  const body = document.querySelector(".node-body");
  const widths = {screen:25, detail:40};
  const applyWidths = () => {
    const width = body.clientWidth; if (width <= 760) return;
    const screen = Math.max(150, Math.min(width * widths.screen / 100, width - 470));
    const detail = Math.max(310, Math.min(width * widths.detail / 100, width - screen - 160));
    body.style.setProperty("--screen-width", screen + "px"); body.style.setProperty("--detail-width", detail + "px");
  };
  for (const side of ["screen", "detail"]) {
    const handle = document.getElementById("node-resize-" + side), pane = document.querySelector(".node-" + side);
    const resize = pixels => {
      const width = body.clientWidth, other = document.querySelector(side === "screen" ? ".node-detail" : ".node-screen").getBoundingClientRect().width;
      const percent = Math.min(Math.max(side === "screen" ? 150 : 310, pixels), width - other - 160) / width * 100;
      widths[side] = percent; applyWidths();
      try { localStorage.setItem("xs-node-" + side + "-width", String(percent)); } catch {}
    };
    try { const saved = Number(localStorage.getItem("xs-node-" + side + "-width")); if (saved >= 10 && saved <= 60) widths[side] = saved; } catch {}
    handle.addEventListener("pointerdown", e => {
      e.preventDefault(); const start = e.clientX, width = pane.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      const move = ev => resize(width + (ev.clientX - start) * (side === "screen" ? 1 : -1));
      const done = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("lostpointercapture", done); };
      handle.addEventListener("pointermove", move); handle.addEventListener("lostpointercapture", done);
    });
    handle.addEventListener("keydown", e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); resize(pane.getBoundingClientRect().width + (e.key === "ArrowRight" ? 20 : -20) * (side === "screen" ? 1 : -1)); } });
    handle.addEventListener("dblclick", () => { widths[side] = side === "screen" ? 25 : 40; applyWidths(); try { localStorage.removeItem("xs-node-" + side + "-width"); } catch {} });
  }
  new ResizeObserver(applyWidths).observe(body); applyWidths();
})();
