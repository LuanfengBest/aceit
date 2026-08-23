"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 语音陪练。
 *
 * 用浏览器内置的 SpeechSynthesis（出题）和 SpeechRecognition（听回答），
 * 都不花钱。代价是 SpeechRecognition 只有 Chrome 系支持，
 * 而且只听系统默认输入设备——这个限制在实时提词那边是个坎，
 * 但陪练场景下人就是对着麦克风说，没问题。
 */

export interface RelatedRef {
  questionId: number;
  questionText: string;
  approach: { title: string; content: string; evidence: string | null } | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
}

export interface Critique {
  score: number;
  answered: { ok: boolean; note: string };
  grounded: { ok: boolean; note: string };
  structure: { ok: boolean; note: string };
  delivery: { ok: boolean; note: string };
  nextStep: string;
  polished: string;
}

type Phase = "idle" | "asking" | "listening" | "thinking" | "done";

// 浏览器的类型定义里没有 webkit 前缀这套
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
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

export function VoicePractice({
  question,
  onSaved,
}: {
  question: { id: number; text: string; scope: string | null };
  onSaved?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [critique, setCritique] = useState<Critique | null>(null);
  const [answerId, setAnswerId] = useState<number | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [related, setRelated] = useState<RelatedRef[] | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    setSupported(getRecognition() !== null);
    return () => {
      recRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // 换题就把上一题的状态清干净
  useEffect(() => {
    recRef.current?.abort();
    window.speechSynthesis?.cancel();
    setPhase("idle");
    setTranscript("");
    setInterim("");
    setCritique(null);
    setAnswerId(null);
    setVersion(null);
    setRelated(null);
    setShowHints(false);
    setError(null);
    finalRef.current = "";
  }, [question.id]);

  const speak = useCallback((text: string, after?: () => void) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      after?.();
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    u.onend = () => after?.();
    u.onerror = () => after?.();
    synth.speak(u);
  }, []);

  function startListening() {
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    recRef.current = rec;
    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);

    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) finalRef.current += text;
        else pending += text;
      }
      setTranscript(finalRef.current);
      setInterim(pending);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") return;
      setError(
        e.error === "not-allowed"
          ? "麦克风权限被拒了，浏览器地址栏左边可以改"
          : `识别出错：${e.error}`
      );
      setPhase("idle");
    };
    rec.onend = () => {
      setInterim("");
    };

    rec.start();
    setPhase("listening");
  }

  function ask() {
    setPhase("asking");
    speak(question.text, () => startListening());
  }

  async function submit() {
    recRef.current?.stop();
    const said = (finalRef.current + interim).trim();
    if (said.length < 4) {
      setError("没听到内容。是不是麦克风没收到？");
      setPhase("idle");
      return;
    }
    setPhase("thinking");
    setError(null);
    try {
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: question.id, transcript: said }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "评点失败");
        setPhase("idle");
        return;
      }
      setCritique(data.critique);
      setAnswerId(data.answerId);
      setVersion(data.version);
      setPhase("done");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  async function loadHints() {
    setShowHints(true);
    if (related !== null) return;
    try {
      const res = await fetch(`/api/questions/${question.id}/related`);
      const data = await res.json();
      setRelated(res.ok ? (data.related ?? []) : []);
    } catch {
      setRelated([]);
    }
  }

  async function keep() {
    if (answerId === null) return;
    await fetch(`/api/answers/${answerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "keeper" }),
    });
    onSaved?.();
  }

  const dims = critique
    ? ([
        ["Answered it", critique.answered],
        ["Matches your record", critique.grounded],
        ["Structure", critique.structure],
        ["Delivery", critique.delivery],
      ] as const)
    : [];

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
            {question.scope === "universal" ? "Comes up everywhere" : "Domain question"}
          </p>
          <p className="mt-1.5 text-section">{question.text}</p>
        </div>
        <button
          type="button"
          onClick={loadHints}
          className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
        >
          From the wild
        </button>
      </div>

      {showHints && (
        <div className="mt-3 rounded-md border border-mint bg-mint/25 px-3.5 py-3">
          {related === null ? (
            <p className="text-meta text-muted-foreground">找面经里的同类题…</p>
          ) : related.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              面经里没找到同类的题。这道你得自己想。
            </p>
          ) : (
            <ul className="space-y-3">
              {related.map((r) => (
                <li key={r.questionId}>
                  <div className="flex items-baseline gap-2">
                    <p className="text-meta text-foreground">{r.questionText}</p>
                    {r.sourceUrl && (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto max-w-[14rem] shrink-0 truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 hover:decoration-accent"
                      >
                        {r.sourceTitle || "原文"} ↗
                      </a>
                    )}
                  </div>
                  {r.approach ? (
                    <p className="mt-1 text-meta text-muted-foreground">
                      <span className="text-mint-ink">别人怎么答：</span>
                      {r.approach.content}
                    </p>
                  ) : (
                    <p className="mt-1 text-meta text-muted-foreground">
                      这条面经只记了题，没记答法。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!supported && (
        <p className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-meta text-muted-foreground">
          这个浏览器不支持语音识别。Chrome / Edge 可以，Safari 不行。
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phase === "idle" && (
          <>
            <button
              type="button"
              onClick={ask}
              disabled={!supported}
              className="rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {critique ? "再来一遍" : "开始"}
            </button>
            <button
              type="button"
              onClick={startListening}
              disabled={!supported}
              className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              跳过念题，直接说
            </button>
          </>
        )}
        {phase === "asking" && (
          <p className="font-mono text-meta text-muted-foreground">正在念题…</p>
        )}
        {phase === "listening" && (
          <>
            <span className="flex items-center gap-2 font-mono text-meta text-accent">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              听着
            </span>
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              答完了
            </button>
          </>
        )}
        {phase === "thinking" && (
          <p className="font-mono text-meta text-muted-foreground">在听你刚才说的…</p>
        )}
      </div>

      {(transcript || interim) && phase !== "done" && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3.5 py-3">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            你说的
          </p>
          <p className="text-meta text-foreground">
            {transcript}
            <span className="text-muted-foreground">{interim}</span>
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-meta text-accent">{error}</p>}

      {critique && phase === "done" && (
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline gap-3">
            <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
              Version {version}
            </p>
            <p className="ml-auto font-mono text-meta text-muted-foreground">
              {critique.score}/100
            </p>
          </div>

          <ul className="space-y-2">
            {dims.map(([label, d]) => (
              <li key={label} className="flex gap-2.5">
                <span
                  className={`mt-0.5 shrink-0 rounded-pill px-2 py-0.5 font-mono text-[11px] ${
                    d.ok ? "bg-mint text-mint-ink" : "bg-peach text-peach-ink"
                  }`}
                >
                  {d.ok ? "OK" : "改"}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-meta text-foreground">{d.note}</p>
                </div>
              </li>
            ))}
          </ul>

          {critique.nextStep && (
            <div className="rounded-md border border-lemon bg-lemon/35 px-3.5 py-2.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-lemon-ink">
                Next take
              </p>
              <p className="mt-1 text-meta text-foreground">{critique.nextStep}</p>
            </div>
          )}

          {critique.polished && (
            <details className="rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Written version
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-meta text-foreground">
                {critique.polished}
              </p>
            </details>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={ask}
              className="rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90"
            >
              再来一遍
            </button>
            <button
              type="button"
              onClick={keep}
              className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              就按这版定稿
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
