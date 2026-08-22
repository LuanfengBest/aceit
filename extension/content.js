// 隔离世界。负责：注入主世界脚本 -> 索要 note 数据 -> POST 到 aceit -> 弹提示。
(() => {
  const REQUEST = "ACEIT_XHS_REQUEST";
  const RESPONSE = "ACEIT_XHS_RESPONSE";
  const ENDPOINT = "http://localhost:3000/api/inbox";
  const MEDIA_ENDPOINT = "http://localhost:3000/api/inbox";
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

  /**
   * 视频笔记：采集当下把视频文件下下来。
   * 小红书视频直链带签名会过期，事后服务端再去拉是 403，
   * 而且口播视频的内容在话里不在画面上，所以要整个文件回去做转写。
   */
  async function fetchVideo(videoUrl) {
    if (!videoUrl) return null;
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      // 太大的先不传，避免卡住采集
      if (blob.size > 200 * 1024 * 1024) return null;
      return blob;
    } catch {
      return null;
    }
  }

  // 视频直链藏在 note 的多层结构里，直接对 JSON 文本做正则最省事。优先 mp4。
  function pickVideoUrl(noteJson) {
    const matches = noteJson.match(/https?:[^"]*?\.(mp4|m3u8)[^"]*/g);
    if (!matches || matches.length === 0) return null;
    return matches.find((u) => u.includes(".mp4")) || matches[0];
  }

  async function buildPayload(note, noteJson) {
    const videoUrl = note.type === "video" ? pickVideoUrl(noteJson) : null;

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
      video_url: videoUrl,
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

      const payload = await buildPayload(note, noteJson);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      const label = body.status === "updated" ? "已更新" : "已保存";

      // 视频笔记：紧接着把视频文件传上去，供服务端转写
      if (note.type === "video" && body.id) {
        toast("正在上传视频（用于转文字）…", "pending");
        const blob = await fetchVideo(payload.video_url);
        if (blob) {
          const up = await fetch(`${MEDIA_ENDPOINT}/${body.id}/media`, {
            method: "POST",
            headers: { "Content-Type": "video/mp4" },
            body: blob,
          });
          if (up.ok) {
            const mb = (blob.size / 1024 / 1024).toFixed(1);
            toast(`${label}：${note.title || note.noteId}（视频 ${mb}MB 已上传）`, "success");
            return;
          }
        }
        toast(`${label}，但视频没传上去（可稍后重采）`, "error");
        return;
      }

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
