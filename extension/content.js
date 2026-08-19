// 隔离世界。负责：注入主世界脚本 -> 索要 note 数据 -> POST 到 aceit -> 弹提示。
(() => {
  const REQUEST = "ACEIT_XHS_REQUEST";
  const RESPONSE = "ACEIT_XHS_RESPONSE";
  const ENDPOINT = "http://localhost:3000/api/inbox";
  const TIMEOUT_MS = 3000;

  let seq = 0;
  let busy = false;

  function injectBridge() {
    const el = document.createElement("script");
    el.src = chrome.runtime.getURL("injected.js");
    el.onload = () => el.remove();
    (document.head || document.documentElement).appendChild(el);
  }

  function requestNoteJson() {
    return new Promise((resolve, reject) => {
      const requestId = `aceit-${Date.now()}-${++seq}`;

      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("页面脚本无响应，刷新页面后重试"));
      }, TIMEOUT_MS);

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== RESPONSE || data.requestId !== requestId) return;

        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (data.ok) resolve(data.noteJson);
        else reject(new Error(data.error || "读取笔记失败"));
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ type: REQUEST, requestId }, "*");
    });
  }

  // 视频直链藏在 note 的多层结构里，直接对 JSON 文本做正则最省事。优先 mp4。
  function pickVideoUrl(noteJson) {
    const matches = noteJson.match(/https?:[^"]*?\.(mp4|m3u8)[^"]*/g);
    if (!matches || matches.length === 0) return null;
    return matches.find((u) => u.includes(".mp4")) || matches[0];
  }

  function buildPayload(note, noteJson) {
    const images = (note.imageList || [])
      .map((img) => img.urlDefault || img.urlPre || img.url)
      .filter(Boolean);
    const tags = (note.tagList || []).map((tag) => tag.name).filter(Boolean);

    return {
      source: "xiaohongshu",
      source_id: note.noteId,
      source_url: location.href,
      type: note.type === "video" ? "video" : "normal",
      title: note.title || null,
      desc: note.desc || null,
      author: (note.user && note.user.nickname) || null,
      images,
      video_url: note.type === "video" ? pickVideoUrl(noteJson) : null,
      tags,
      published_at: note.time ? new Date(note.time).toISOString() : null,
      raw: note,
    };
  }

  async function capture() {
    if (busy) return;
    busy = true;
    toast("正在读取笔记…", "pending");

    try {
      const noteJson = await requestNoteJson();
      const note = JSON.parse(noteJson);
      if (!note.noteId) throw new Error("笔记缺少 noteId");

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(note, noteJson)),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      const label = body.status === "updated" ? "已更新" : "已保存";
      toast(`${label}：${note.title || note.noteId}`, "success");
    } catch (err) {
      const message = (err && err.message) || String(err);
      const hint = message === "Failed to fetch" ? "连不上 localhost:3000" : message;
      toast(`失败：${hint}`, "error");
    } finally {
      busy = false;
    }
  }

  // ---- 右上角提示，放进 shadow DOM 免得被页面样式影响 ----
  let host = null;
  let hideTimer = null;

  function toast(text, kind) {
    if (!host) {
      host = document.createElement("div");
      host.style.cssText =
        "position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;";
      host.attachShadow({ mode: "open" }).innerHTML = `
        <style>
          .box {
            font: 500 13px/1.5 -apple-system, "PingFang SC", sans-serif;
            padding: 10px 14px; border-radius: 10px; color: #fff;
            max-width: 320px; word-break: break-all;
            box-shadow: 0 6px 20px rgba(0,0,0,.18);
          }
          .pending { background: #4b5563; }
          .success { background: #16a34a; }
          .error   { background: #dc2626; }
        </style>
        <div class="box"></div>`;
      document.documentElement.appendChild(host);
    }

    const box = host.shadowRoot.querySelector(".box");
    box.className = `box ${kind}`;
    box.textContent = text;
    host.style.display = "block";

    clearTimeout(hideTimer);
    if (kind !== "pending") {
      hideTimer = setTimeout(() => {
        host.style.display = "none";
      }, 2600);
    }
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey) return;
      if (event.code !== "KeyS") return;
      event.preventDefault();
      event.stopPropagation();
      capture();
    },
    true
  );

  injectBridge();
})();
