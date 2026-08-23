"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 一场面试，一个按钮。
 *
 * 之前提词和录音是两个组件、两个 Start——各弹一次「共享标签页」的框，
 * 要选两遍，而且用户得记住两件事都要点。可它们用的是同一路音频：
 * - 提词听**标签页**（面试官那一边）。不听麦克风：
 *   你自己说的话不用提词，混进来只会让它把你的回答当成新问题
 * - 录音要**标签页 + 麦克风**混流，两边的话都得留下来
 *
 * 所以采一次，分两路用：
 *   标签页 ──┬─→ 8 秒切片 → whisper → 提词
 *            └─→ ┐
 *   麦克风 ──────┴─→ 混流 → MediaRecorder → 整场录音 → 结束后转写复盘
 */

const CHUNK_MS = 8000;
/** 喂给模型判断的上下文。太长会把上一题的内容带进来 */
const CONTEXT_CHARS = 300;

interface Prompt {
  asked: boolean;
  question: string;
  points: string[];
  useStory: string;
  watchOut: string;
  prepared: { questionText: string; content: string; version: number } | null;
}

type Phase = "idle" | "live" | "uploading" | "transcribing" | "done";

export function InterviewSession({
  roles,
}: {
  roles: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [roleId, setRoleId] = useState<number | "">(roles[0]?.id ?? "");
  const [company, setCompany] = useState("");
  const [round, setRound] = useState("");
  const [promptOn, setPromptOn] = useState(true);

  const [seconds, setSeconds] = useState(0);
  const [tabLevel, setTabLevel] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [noTabAudio, setNoTabAudio] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [thinking, setThinking] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ chars: number } | null>(null);

  const stopRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const heardRef = useRef("");
  const inFlight = useRef(false);
  const promptOnRef = useRef(true);
  const roleRef = useRef<number | "">("");

  async function handleChunk(blob: Blob) {
    if (!promptOnRef.current || blob.size < 2048) return;
    try {
      const res = await fetch("/api/live/transcribe", { method: "POST", body: blob });
      const data = await res.json();
      const text = (data.text ?? "").trim();
      if (!text) return;

      heardRef.current = (heardRef.current + " " + text).slice(-2000);
      setHeard(heardRef.current);

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
            roleId: roleRef.current === "" ? null : roleRef.current,
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
    setResult(null);
    setPrompt(null);
    setNoTabAudio(false);
    heardRef.current = "";
    setHeard("");
    promptOnRef.current = promptOn;
    roleRef.current = roleId;

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);

      const tabAudio = display.getAudioTracks()[0] ?? null;
      if (!tabAudio) setNoTabAudio(true);

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

      const ctx = new AudioContext();
      // getDisplayMedia 的 await 之后用户手势可能已失效，AudioContext 会停在 suspended
      if (ctx.state === "suspended") await ctx.resume();
      const dest = ctx.createMediaStreamDestination();

      const meter = (stream: MediaStream, set: (v: number) => void) => {
        if (stream.getAudioTracks().length === 0) return null;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(dest); // 同时并进混流
        const buf = new Uint8Array(analyser.frequencyBinCount);
        return () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          set(Math.min(1, peak / 60));
        };
      };
      const readTab = tabAudio ? meter(display, setTabLevel) : null;
      const readMic = meter(mic, setMicLevel);

      // 整场录音：两路混一起
      const full = new MediaRecorder(dest.stream);
      const chunks: Blob[] = [];
      full.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

      // 提词：只切标签页那一路。混流里有你自己的声音，
      // 会被当成新问题，所以单独开一个录制器
      let live: MediaRecorder | null = null;
      if (tabAudio) {
        live = new MediaRecorder(new MediaStream([tabAudio]));
        live.ondataavailable = (e) => void handleChunk(e.data);
      }

      let raf = 0;
      const tick = () => {
        readTab?.();
        readMic?.();
        raf = requestAnimationFrame(tick);
      };
      tick();

      const t0 = Date.now();
      const timer = setInterval(
        () => setSeconds(Math.round((Date.now() - t0) / 1000)),
        250
      );

      full.onstop = async () => {
        cancelAnimationFrame(raf);
        clearInterval(timer);
        live?.state !== "inactive" && live?.stop();
        display.getTracks().forEach((t) => t.stop());
        mic.getTracks().forEach((t) => t.stop());
        void ctx.close();
        await upload(
          new Blob(chunks, { type: "audio/webm" }),
          Math.round((Date.now() - t0) / 1000)
        );
      };

      full.start(1000);
      live?.start(CHUNK_MS);
      stopRef.current = () => full.stop();
      setSeconds(0);
      setPhase("live");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "共享被取消了。要收到面试官的声音，得在弹窗里选「Chrome 标签页」并勾上「同时分享标签页音频」。"
          : err instanceof Error
            ? err.message
            : String(err)
      );
      setPhase("idle");
    }
  }

  async function upload(blob: Blob, secs: number) {
    setPhase("uploading");
    try {
      const qs = new URLSearchParams({ seconds: String(secs) });
      if (roleId !== "") qs.set("roleId", String(roleId));
      if (company.trim()) qs.set("company", company.trim());
      if (round.trim()) qs.set("round", round.trim());

      const up = await fetch(`/api/recordings?${qs}`, { method: "POST", body: blob });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error ?? "保存失败");

      setPhase("transcribing");
      const tr = await fetch(`/api/recordings/${upData.id}/transcribe`, { method: "POST" });
      const trData = await tr.json();
      if (!tr.ok) throw new Error(trData.error ?? "转写失败");

      setResult({ chars: trData.chars });
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;
  const busy = phase === "uploading" || phase === "transcribing";

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          During the interview
        </p>
        <p className="text-[12px] text-muted-foreground">
          One button. It listens to their tab, prompts you live, and keeps the whole
          recording for the debrief afterwards. Nothing leaves this machine.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={String(roleId)}
          onChange={(e) => setRoleId(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={phase !== "idle"}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        >
          <option value="">No role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={phase !== "idle"}
          placeholder="Company"
          className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <input
          value={round}
          onChange={(e) => setRound(e.target.value)}
          disabled={phase !== "idle"}
          placeholder="Round"
          className="w-24 rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none disabled:opacity-50"
        />

        {phase === "idle" && (
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-meta text-muted-foreground">
              <input
                type="checkbox"
                checked={promptOn}
                onChange={(e) => setPromptOn(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Prompt me live
            </label>
            <button
              type="button"
              onClick={() => void start()}
              className="ml-auto rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              Start interview
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Upload a recording
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f, 0);
                e.target.value = "";
              }}
            />
          </>
        )}

        {phase === "live" && (
          <>
            <span className="ml-auto flex items-center gap-2 font-mono text-meta text-accent">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              {thinking ? "thinking" : "live"} · {mmss}
            </span>
            <button
              type="button"
              onClick={() => stopRef.current?.()}
              className="rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              End interview
            </button>
          </>
        )}

        {busy && (
          <span className="ml-auto font-mono text-meta text-muted-foreground">
            {phase === "uploading" ? "Saving…" : "Transcribing — a few minutes"}
          </span>
        )}
      </div>

      {phase === "live" && (
        <div className="mt-3 space-y-2">
          {[
            { label: "Interviewer (tab)", v: tabLevel, warn: noTabAudio },
            { label: "You (mic)", v: micLevel, warn: false },
          ].map((m) => (
            <div key={m.label} className="flex items-center gap-2.5">
              <span className="w-36 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {m.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-2">
                <div
                  className={`h-full rounded-pill transition-[width] duration-75 ${
                    m.warn ? "bg-peach-ink/50" : "bg-accent"
                  }`}
                  style={{ width: `${Math.round(m.v * 100)}%` }}
                />
              </div>
            </div>
          ))}
          {noTabAudio && (
            <p className="text-meta text-peach-ink">
              没拿到标签页音频 —— 多半是选了「窗口」或「整个屏幕」。macOS
              上只有选「Chrome 标签页」并勾上「同时分享标签页音频」才会给音频轨。
              现在只录得到你自己，也没法提词。
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-meta text-accent">{error}</p>}

      {result && (
        <p className="mt-3 rounded-md border border-mint bg-mint/30 px-3.5 py-2.5 text-meta text-mint-ink">
          录完了，转写 {result.chars} 字。下面点「Break it down」把被问到的题拆出来。
        </p>
      )}

      {/* ── 实时提词 ── */}
      {phase === "live" && prompt && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              They asked
            </p>
            <p className="mt-0.5 text-body">{prompt.question}</p>
          </div>

          {/* 练过的答案摆最前面：花时间打磨过的比现出的框架靠谱得多 */}
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

      {phase === "live" && heard && (
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
