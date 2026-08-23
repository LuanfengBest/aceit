"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 面试进行中的实时提词。
 *
 * 听的是标签页音频——面试官那一边。不听麦克风：你自己说的话不用提词，
 * 混进来只会让它把你的回答当成新问题。
 *
 * 为什么不用浏览器的 SpeechRecognition：它只听系统默认输入设备，
 * 不接受指定的 MediaStream。所以走本地 whisper 切片，
 * 8 秒一段录、一段一段转，实测从对方问完到出提示 4-5 秒。
 *
 * 最有用的其实不是现出的框架，是**你自己练过的那版答案**——
 * 那一步只查库不调模型，出得最快。
 */

const CHUNK_MS = 8000;
/** 喂给模型判断的上下文长度。太长会把上一题的内容带进来 */
const CONTEXT_CHARS = 300;

interface Prompt {
  asked: boolean;
  question: string;
  points: string[];
  useStory: string;
  watchOut: string;
  prepared: { questionText: string; content: string; version: number } | null;
}

export function LivePrompter({ roles }: { roles: { id: number; title: string }[] }) {
  const [on, setOn] = useState(false);
  const [roleId, setRoleId] = useState<number | "">(roles[0]?.id ?? "");
  const [heard, setHeard] = useState("");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState(0);

  const stopRef = useRef<(() => void) | null>(null);
  const heardRef = useRef("");
  const inFlight = useRef(false);

  useEffect(() => () => stopRef.current?.(), []);

  async function handleChunk(blob: Blob) {
    if (blob.size < 2048) return;
    try {
      const res = await fetch("/api/live/transcribe", { method: "POST", body: blob });
      const data = await res.json();
      const text = (data.text ?? "").trim();
      if (!text) return;

      heardRef.current = (heardRef.current + " " + text).slice(-2000);
      setHeard(heardRef.current);
      setChunks((n) => n + 1);

      // 上一次还没回来就跳过这一轮：宁可漏一段，也别把提示排成长队
      if (inFlight.current) return;
      inFlight.current = true;
      setThinking(true);
      try {
        const p = await fetch("/api/live/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recent: heardRef.current.slice(-CONTEXT_CHARS),
            roleId: roleId === "" ? null : roleId,
          }),
        });
        const pd = await p.json();
        if (pd.asked) setPrompt(pd);
      } finally {
        inFlight.current = false;
        setThinking(false);
      }
    } catch {
      // 单段挂了不影响后面的
    }
  }

  async function start() {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);

      if (display.getAudioTracks().length === 0) {
        display.getTracks().forEach((t) => t.stop());
        setError(
          "没拿到标签页音频。macOS 上只有选「Chrome 标签页」并勾上「同时分享标签页音频」才有——选窗口或整个屏幕都不行。"
        );
        return;
      }

      const audioOnly = new MediaStream(display.getAudioTracks());
      const rec = new MediaRecorder(audioOnly);
      rec.ondataavailable = (e) => void handleChunk(e.data);
      // timeslice 让它每 8 秒吐一段，不用自己起停
      rec.start(CHUNK_MS);

      stopRef.current = () => {
        rec.state !== "inactive" && rec.stop();
        display.getTracks().forEach((t) => t.stop());
        stopRef.current = null;
        setOn(false);
      };
      heardRef.current = "";
      setHeard("");
      setPrompt(null);
      setChunks(0);
      setOn(true);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "共享被取消了。"
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Live prompter
        </p>
        <p className="text-[12px] text-muted-foreground">
          Listens to the interviewer&rsquo;s tab. When they ask something, your own
          practised answer comes up first.
        </p>

        {!on ? (
          <>
            <select
              value={String(roleId)}
              onChange={(e) =>
                setRoleId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="ml-auto rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">No role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              Start listening
            </button>
          </>
        ) : (
          <>
            <span className="ml-auto flex items-center gap-2 font-mono text-meta text-accent">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              {thinking ? "thinking" : "listening"} · {chunks}
            </span>
            <button
              type="button"
              onClick={() => stopRef.current?.()}
              className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-meta text-accent">{error}</p>}

      {prompt && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              They asked
            </p>
            <p className="mt-0.5 text-body">{prompt.question}</p>
          </div>

          {/* 练过的答案排在最前面：那是你花时间打磨过的，
              比现出的框架靠谱得多 */}
          {prompt.prepared && (
            <div className="rounded-md border border-mint bg-mint/30 px-3.5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-mint-ink">
                You practised this — v{prompt.prepared.version}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-body">
                {prompt.prepared.content}
              </p>
            </div>
          )}

          {prompt.points.length > 0 && (
            <div className="rounded-md border border-lemon bg-lemon/35 px-3.5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-lemon-ink">
                {prompt.prepared ? "Or hit these beats" : "Hit these beats"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {prompt.points.map((p) => (
                  <li key={p} className="text-body">
                    · {p}
                  </li>
                ))}
              </ul>
              {prompt.useStory && (
                <p className="mt-2 text-meta text-lemon-ink">Use: {prompt.useStory}</p>
              )}
            </div>
          )}

          {prompt.watchOut && (
            <p className="rounded-md border border-peach bg-peach/40 px-3.5 py-2.5 text-meta text-peach-ink">
              Watch out: {prompt.watchOut}
            </p>
          )}
        </div>
      )}

      {on && heard && (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent">
            What it is hearing
          </summary>
          <p className="mt-1.5 max-h-32 overflow-y-auto text-[12px] leading-relaxed text-muted-foreground">
            {heard.slice(-600)}
          </p>
        </details>
      )}
    </div>
  );
}
