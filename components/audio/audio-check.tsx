"use client";

import { useRef, useState } from "react";

type Phase = "idle" | "live" | "recorded";

/**
 * 验证两件事：
 * 1. 标签页音频（= 面试官的声音）能不能采到
 * 2. 麦克风（= 你的声音）能不能采到
 * 3. 两路混流录出来的文件是不是双方都在
 */
export function AudioCheck() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tabLevel, setTabLevel] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [tabTrack, setTabTrack] = useState<string | null>(null);
  const [micTrack, setMicTrack] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [diag, setDiag] = useState<string[]>([]);

  const cleanupRef = useRef<(() => void) | null>(null);

  async function start() {
    setError(null);
    setUrl(null);
    try {
      // 标签页音频：Chrome 会弹共享选择框，要勾上「分享标签页音频」
      // displaySurface:"browser" 让 Chrome 的选择器直接打开在「标签页」那一栏，
      // 不用自己去点；selfBrowserSurface:"exclude" 把当前这个页面从列表里去掉，
      // 免得又选到 aceit 自己
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
      const displayAudio = display.getAudioTracks()[0] ?? null;
      setTabTrack(displayAudio ? displayAudio.label || "(未命名)" : null);

      const notes: string[] = [];
      notes.push(
        `共享流：视频轨 ${display.getVideoTracks().length} 条，音频轨 ${display.getAudioTracks().length} 条`
      );
      const videoLabel = display.getVideoTracks()[0]?.label ?? "";
      if (videoLabel) notes.push(`共享对象：${videoLabel}`);
      if (!displayAudio) {
        notes.push(
          "没拿到音频轨 —— 多半是选了「整个屏幕」或「窗口」。macOS 上只有选「Chrome 标签页」并勾选「同时分享标签页音频」才会给音频轨。"
        );
      } else {
        const st = displayAudio.getSettings();
        notes.push(
          `音频轨状态：${displayAudio.readyState} · enabled=${displayAudio.enabled} · muted=${displayAudio.muted} · 采样率 ${st.sampleRate ?? "?"}`
        );
      }

      // 麦克风
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micAudio = mic.getAudioTracks()[0] ?? null;
      setMicTrack(micAudio ? micAudio.label || "(未命名)" : null);
      notes.push(`麦克风：${micAudio?.label || "(无)"} · ${micAudio?.readyState ?? "-"}`);
      setDiag(notes);

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

      const readTab = displayAudio ? meter(display, setTabLevel) : null;
      const readMic = micAudio ? meter(mic, setMicLevel) : null;

      const recorder = new MediaRecorder(dest.stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => {
        setUrl(URL.createObjectURL(new Blob(chunks, { type: "audio/webm" })));
        setPhase("recorded");
      };
      recorder.start();

      let raf = 0;
      const tick = () => {
        readTab?.();
        readMic?.();
        raf = requestAnimationFrame(tick);
      };
      tick();

      const t0 = Date.now();
      const timer = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 250);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        clearInterval(timer);
        recorder.state !== "inactive" && recorder.stop();
        display.getTracks().forEach((t) => t.stop());
        mic.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setTabLevel(0);
        setMicLevel(0);
      };

      setPhase("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stop() {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <ol className="mb-4 space-y-1 text-meta text-muted-foreground">
        <li>1. 随便开一个正在放声音的标签页（B 站、YouTube 都行）</li>
        <li>2. 点下面的按钮 → macOS 先问屏幕权限，点 Allow to Share Screen</li>
        <li>
          3. 接着 Chrome 弹出选择器 → 选顶部的
          <span className="text-foreground">「Chrome 标签页」</span>，挑那个标签页
        </li>
        <li>
          4. <span className="text-foreground">左下角勾上「同时分享标签页音频」</span> —— 不勾就采不到
        </li>
        <li>5. 对着麦克风说两句话，看两条音量条是不是都在动</li>
      </ol>

      <p className="mb-6 rounded-md border border-border bg-surface-2 px-4 py-3 text-meta text-muted-foreground">
        为什么要过屏幕共享：浏览器没有单独的「只采音频」权限，标签页声音只能搭着
        标签页画面一起拿。<span className="text-foreground">画面一帧都不会被使用</span>——
        录音接的是混流后的纯音频轨，视频轨拿到就扔着，既不渲染也不写盘。
      </p>

      {phase === "idle" && (
        <button
          type="button"
          onClick={() => void start()}
          className="rounded-md bg-accent px-5 py-2.5 text-body text-accent-foreground transition-opacity hover:opacity-90"
        >
          开始检测
        </button>
      )}

      {phase === "live" && (
        <>
          <div className="space-y-4">
            <Meter label="标签页音频（面试官）" level={tabLevel} track={tabTrack} />
            <Meter label="麦克风（你）" level={micLevel} track={micTrack} />
          </div>
          <div className="mt-6 flex items-center gap-4">
            <button
              type="button"
              onClick={stop}
              className="rounded-md bg-accent px-5 py-2.5 text-body text-accent-foreground"
            >
              停止并回放
            </button>
            <span className="font-mono text-meta text-muted-foreground">
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </span>
          </div>
        </>
      )}

      {phase === "recorded" && url && (
        <div>
          <p className="mb-3 text-body">
            回放混流录音 —— 如果双方声音都在，这套方案就成立。
          </p>
          <audio src={url} controls className="w-full" />
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setSeconds(0);
            }}
            className="mt-4 rounded-md border border-border px-4 py-2 text-meta text-muted-foreground transition-colors hover:border-accent"
          >
            再测一次
          </button>
        </div>
      )}

      {diag.length > 0 && (
        <div className="mt-6 rounded-md border border-border bg-bg p-4">
          <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
            诊断
          </p>
          <ul className="mt-2 space-y-1">
            {diag.map((d, i) => (
              <li key={i} className="text-meta text-muted-foreground">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-4 text-meta text-danger">出错：{error}</p>}
    </div>
  );
}

function Meter({
  label,
  level,
  track,
}: {
  label: string;
  level: number;
  track: string | null;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-body">{label}</span>
        <span
          className={`font-mono text-meta ${track ? "text-mint-ink" : "text-danger"}`}
        >
          {track ? `轨道已获取 · ${track.slice(0, 30)}` : "没有音频轨道"}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-pill bg-surface-2">
        <div
          className="h-full rounded-pill bg-accent transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}
