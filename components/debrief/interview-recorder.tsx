"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 面试录音 → 转写 → 复盘。
 *
 * 双轨采集：标签页音频（面试官那边的声音）+ 麦克风（你自己），
 * 在浏览器里用 Web Audio 混成一路再录。这套在 /audio-check 验证过了。
 *
 * macOS 上有个坑：只有共享 **Chrome 标签页** 才会给音频轨，
 * 共享「窗口」或「整个屏幕」都拿不到。所以下面强制
 * displaySurface:"browser"，让选择器直接开在标签页那一栏。
 *
 * 录音存本地、whisper 也在本地跑——面试内容里有公司信息和面试官原话，
 * 这是不该传第三方的东西。
 */

type Phase = "idle" | "recording" | "uploading" | "transcribing" | "done";

export function InterviewRecorder({
  roles,
}: {
  roles: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [tabLevel, setTabLevel] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [noTabAudio, setNoTabAudio] = useState(false);
  const [roleId, setRoleId] = useState<number | "">(roles[0]?.id ?? "");
  const [company, setCompany] = useState("");
  const [round, setRound] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; chars: number } | null>(null);

  const stopRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function start() {
    setError(null);
    setResult(null);
    setNoTabAudio(false);
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

      const recorder = new MediaRecorder(dest.stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

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

      recorder.onstop = async () => {
        cancelAnimationFrame(raf);
        clearInterval(timer);
        display.getTracks().forEach((t) => t.stop());
        mic.getTracks().forEach((t) => t.stop());
        void ctx.close();
        const blob = new Blob(chunks, { type: "audio/webm" });
        await upload(blob, Math.round((Date.now() - t0) / 1000));
      };

      recorder.start(1000);
      stopRef.current = () => recorder.stop();
      setSeconds(0);
      setPhase("recording");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "共享被取消了。要录面试官的声音，得在弹窗里选「Chrome 标签页」并勾上「同时分享标签页音频」。"
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
      if (!up.ok) throw new Error(upData.error ?? "上传失败");

      setPhase("transcribing");
      const tr = await fetch(`/api/recordings/${upData.id}/transcribe`, {
        method: "POST",
      });
      const trData = await tr.json();
      if (!tr.ok) throw new Error(trData.error ?? "转写失败");

      setResult({ id: upData.id, chars: trData.chars });
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  async function pickFile(file: File) {
    setError(null);
    setResult(null);
    await upload(file, 0);
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;

  const busy = phase === "uploading" || phase === "transcribing";

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Record the interview
        </p>
        <p className="text-[12px] text-muted-foreground">
          Both sides are captured — their voice from the tab, yours from the mic.
          Nothing leaves this machine.
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
            <button
              type="button"
              onClick={() => void start()}
              className="ml-auto rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Upload a file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
                e.target.value = "";
              }}
            />
          </>
        )}

        {phase === "recording" && (
          <button
            type="button"
            onClick={() => stopRef.current?.()}
            className="ml-auto rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
          >
            Stop · {mmss}
          </button>
        )}

        {busy && (
          <span className="ml-auto font-mono text-meta text-muted-foreground">
            {phase === "uploading" ? "Saving…" : "Transcribing — this takes a few minutes"}
          </span>
        )}
      </div>

      {phase === "recording" && (
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
              现在这一路只有你自己的声音。
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-meta text-accent">{error}</p>}

      {result && (
        <p className="mt-3 rounded-md border border-mint bg-mint/30 px-3.5 py-2.5 text-meta text-mint-ink">
          转写完成，{result.chars} 字。下面点「Break it down」把被问到的题拆出来。
        </p>
      )}
    </div>
  );
}
