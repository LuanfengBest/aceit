"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 对话式模拟面试。
 *
 * 和上面的题库练习是互补关系：
 * 题库练的是**已知的题**，这里发现的是**你没准备到的题**——
 * 面试官顺着你的回答临场决定下一问。
 * 结束时这一场问过的题会沉淀回题库，下次能接着练。
 */

interface Turn {
  role: "interviewer" | "me";
  content: string;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function MockInterview({ roles }: { roles: { id: number; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jd, setJd] = useState("");
  const [roleId, setRoleId] = useState<number | "new">(roles[0]?.id ?? "new");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [roleTitle, setRoleTitle] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [harvest, setHarvest] = useState<number | null>(null);
  const [speakOn, setSpeakOn] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(
    () => () => {
      recRef.current?.abort();
      window.speechSynthesis?.cancel();
    },
    []
  );

  function speak(text: string) {
    if (!speakOn) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1;
    synth.speak(u);
  }

  async function start() {
    setBusy("start");
    setError(null);
    setHarvest(null);
    try {
      const res = await fetch("/api/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          jd.trim().length >= 30 ? { jd: jd.trim() } : { roleId: roleId === "new" ? null : roleId }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "开场失败");
      setSessionId(data.sessionId);
      setRoleTitle(data.roleTitle);
      setTurns([{ role: "interviewer", content: data.opening }]);
      speak(data.opening);
      // 粘了 JD 会顺手建画像，Roles 和 Studio 都要跟着刷新
      if (jd.trim().length >= 30) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function send(text: string) {
    if (sessionId === null || text.trim().length < 2) return;
    stopListening();
    setTurns((t) => [...t, { role: "me", content: text.trim() }]);
    setDraft("");
    setBusy("reply");
    setError(null);
    try {
      const res = await fetch(`/api/mock/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "出错了");
      setTurns((t) => [...t, { role: "interviewer", content: data.reply }]);
      speak(data.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function end() {
    if (sessionId === null) return;
    setBusy("end");
    stopListening();
    window.speechSynthesis?.cancel();
    try {
      const res = await fetch(`/api/mock/${sessionId}`, { method: "PATCH" });
      const data = await res.json();
      setHarvest(data.harvested ?? 0);
      setSessionId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function startListening() {
    const rec = getRecognition();
    if (!rec) {
      setError("这个浏览器不支持语音识别。Chrome / Edge 可以。");
      return;
    }
    window.speechSynthesis?.cancel();
    recRef.current = rec;
    finalRef.current = draft;
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalRef.current += t;
        else pending += t;
      }
      setDraft(finalRef.current + pending);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") return;
      setError(e.error === "not-allowed" ? "麦克风权限被拒了" : `识别出错：${e.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  }

  function stopListening() {
    recRef.current?.stop();
    setListening(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 w-full rounded-lg border border-dashed border-accent/50 bg-accent-soft/40 px-5 py-3.5 text-left transition-colors hover:border-accent"
      >
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-accent">
          Mock interview
        </p>
        <p className="mt-1 text-meta text-muted-foreground">
          粘一份 JD 直接开面 —— 面试官顺着你的回答临场追问，
          结束后这一场问过的题会沉淀回题库。
        </p>
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-accent/40 bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-accent">
          Mock interview
        </p>
        {roleTitle && (
          <span className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-meta text-accent">
            {roleTitle}
          </span>
        )}
        {sessionId !== null && (
          <>
            <button
              type="button"
              onClick={() => setSpeakOn((v) => !v)}
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
            >
              {speakOn ? "朗读 开" : "朗读 关"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void end()}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {busy === "end" ? "沉淀中…" : "结束并沉淀"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            stopListening();
            window.speechSynthesis?.cancel();
            setOpen(false);
          }}
          className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          收起
        </button>
      </div>

      {sessionId === null ? (
        <div className="space-y-3 px-5 py-4">
          {harvest !== null && (
            <p className="rounded-md border border-mint bg-mint/30 px-3.5 py-2.5 text-meta text-mint-ink">
              这场结束了，沉淀了 {harvest} 道题进题库。下面的队列里能找到它们。
            </p>
          )}
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={5}
            placeholder="粘一份新的 JD 到这里，直接开面。&#10;（粘了会自动建/并入岗位画像，Roles 和 Studio 里都能看到，不用再贴一遍）"
            className="w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-muted-foreground">或者面已有的岗位：</span>
            <select
              value={String(roleId)}
              onChange={(e) => setRoleId(e.target.value === "new" ? "new" : Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-meta text-foreground focus:border-accent focus:outline-none"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
              <option value="new">不指定岗位（通用面）</option>
            </select>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void start()}
              className="ml-auto rounded-md bg-accent px-4 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === "start" ? "面试官在准备…" : "开始面试"}
            </button>
          </div>
          {error && <p className="text-meta text-accent">{error}</p>}
        </div>
      ) : (
        <>
          <div ref={feedRef} className="max-h-[26rem] space-y-3 overflow-y-auto px-5 py-4">
            {turns.map((t, i) => (
              <div
                key={i}
                className={`flex ${t.role === "me" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 ${
                    t.role === "me"
                      ? "bg-accent-soft text-foreground"
                      : "border border-border bg-surface-2 text-foreground"
                  }`}
                >
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {t.role === "me" ? "你" : "面试官"}
                  </p>
                  <p className="whitespace-pre-wrap text-meta">{t.content}</p>
                </div>
              </div>
            ))}
            {busy === "reply" && (
              <p className="font-mono text-meta text-muted-foreground">面试官在想…</p>
            )}
          </div>

          <div className="border-t border-border px-5 py-3">
            {error && <p className="mb-2 text-meta text-accent">{error}</p>}
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                rows={2}
                placeholder="打字回答，或者点右边的麦克风说。⌘↵ 发送"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3.5 py-2 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
              />
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => (listening ? stopListening() : startListening())}
                  className={`rounded-md border px-3 py-1 font-mono text-[11px] transition-colors ${
                    listening
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {listening ? "听着…" : "说"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || draft.trim().length < 2}
                  onClick={() => void send(draft)}
                  className="rounded-md bg-accent px-3 py-1 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
