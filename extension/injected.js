// 运行在页面主世界（main world）。content script 处于隔离世界，读不到 window.__INITIAL_STATE__，
// 所以由这段脚本读取笔记数据，再用 window.postMessage 把 JSON 字符串传回 content script。
(() => {
  const REQUEST = "ACEIT_XHS_REQUEST";
  const RESPONSE = "ACEIT_XHS_RESPONSE";

  if (window.__aceitXhsBridgeReady) return;
  window.__aceitXhsBridgeReady = true;

  // 当前 URL 里的笔记 id，用来在 noteDetailMap 有多条时选中正确的那条。
  function noteIdFromUrl() {
    const segments = location.pathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^[0-9a-f]{24}$/i.test(segments[i])) return segments[i];
    }
    return null;
  }

  function readNote() {
    const state = window.__INITIAL_STATE__;
    if (!state) throw new Error("页面没有 __INITIAL_STATE__");

    const map = state.note && state.note.noteDetailMap;
    if (!map) throw new Error("当前页面没有笔记数据（noteDetailMap 不存在）");

    const key = noteIdFromUrl();
    const entry = (key && map[key]) || Object.values(map)[0];
    const note = entry && entry.note;
    if (!note) throw new Error("noteDetailMap 里没有 note 对象");

    // 只 stringify note 本身。整个 __INITIAL_STATE__ 有循环引用，会抛错。
    return JSON.stringify(note);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== REQUEST) return;

    try {
      window.postMessage(
        { type: RESPONSE, requestId: data.requestId, ok: true, noteJson: readNote() },
        "*"
      );
    } catch (err) {
      window.postMessage(
        {
          type: RESPONSE,
          requestId: data.requestId,
          ok: false,
          error: (err && err.message) || String(err),
        },
        "*"
      );
    }
  });
})();
