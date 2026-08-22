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

  /**
   * 视频笔记：采集当下就抽几帧。
   * 小红书视频直链带签名会过期，事后服务端再去拉是 403，所以必须在这里抓。
   * 先把视频 fetch 成 blob（页面上下文带着正确的 Referer 和 cookie），
   * 再用 blob URL 喂给一个新的 video 元素——这样 canvas 不会被跨域污染。
   */
  async function grabFrames(videoUrl, count = 4) {
    if (!videoUrl) return [];
    let objectUrl = null;
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) return [];
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("视频解码失败"));
        setTimeout(() => reject(new Error("视频加载超时")), 20000);
      });

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) return [];

      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");

      const frames = [];
      for (let i = 1; i <= count; i++) {
        // 均匀取样，跳过片头片尾
        const t = (duration * i) / (count + 1);
        await new Promise((resolve, reject) => {
          video.onseeked = resolve;
          video.onerror = () => reject(new Error("seek 失败"));
          video.currentTime = t;
          setTimeout(resolve, 4000);
        });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.82));
      }
      return frames;
    } catch {
      return [];
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
    // 视频笔记多抓几帧，图文笔记不用
    const frames = videoUrl ? await grabFrames(videoUrl) : [];

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
      frames,
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

      if (note.type === "video") toast("正在抽取视频画面…", "pending");
      const payload = await buildPayload(note, noteJson);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
