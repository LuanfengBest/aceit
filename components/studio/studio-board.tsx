"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Answer, Question, RoleProfile } from "@/lib/db/schema";
import { VoicePractice } from "@/components/studio/voice-practice";

export interface ReusableAnswer {
  answerId: number;
  content: string;
  version: number;
  fromQuestionId: number;
  fromQuestionText: string;
}

export interface QuestionWithAnswers {
  question: Question;
  answers: Answer[];
  /** 同 cluster 别的题已经定稿的答案，universal 题才有 */
  reusable: ReusableAnswer | null;
  /** 追问，跟着主问题走 */
  followUps: { question: Question; answers: Answer[] }[];
}

const KIND_TONE: Record<string, string> = {
  behavioral: "bg-lavender text-lavender-ink",
  technical: "bg-mint text-mint-ink",
  case: "bg-peach text-peach-ink",
  resume: "bg-lemon text-lemon-ink",
  other: "bg-surface-2 text-muted-foreground",
};

/** 一道题练到哪一步了 */
type Progress = "keeper" | "draft" | "fresh";

function progressOf(rows: Answer[]): Progress {
  if (rows.some((a) => a.status === "keeper")) return "keeper";
  return rows.length > 0 ? "draft" : "fresh";
}

const PROGRESS_MARK: Record<Progress, { mark: string; tone: string; label: string }> = {
  keeper: { mark: "●", tone: "text-mint-ink", label: "Locked" },
  draft: { mark: "◐", tone: "text-accent", label: "In progress" },
  fresh: { mark: "○", tone: "text-muted-foreground", label: "Untouched" },
};

export function StudioBoard({
  roles,
  activeRoleId,
  items,
  experienceTitles,
}: {
  roles: RoleProfile[];
  activeRoleId: number | null;
  items: QuestionWithAnswers[];
  experienceTitles: Record<number, string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(items[0]?.question.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  // 连击模式：主问题答完直接问追问，不停下来评点，更像真实面试
  const [chain, setChain] = useState(false);
  const [chainStep, setChainStep] = useState(0);

  const current = items.find((i) => i.question.id === selected) ?? items[0] ?? null;

  // 连击模式下，当前该问的是主问题还是第几条追问
  const chainQuestions = useMemo(() => {
    if (!current) return [];
    return [current.question, ...current.followUps.map((f) => f.question)];
  }, [current]);
  const asking = chain ? (chainQuestions[chainStep] ?? current?.question) : current?.question;

  const askingAnswers =
    asking && current
      ? asking.id === current.question.id
        ? current.answers
        : (current.followUps.find((f) => f.question.id === asking.id)?.answers ?? [])
      : [];
  const versions = [...askingAnswers].sort((a, b) => a.version - b.version);
  const latest = versions[versions.length - 1] ?? null;
  const keeper = versions.find((v) => v.status === "keeper") ?? null;

  // 队列按 scope 分组：universal 排前面，那些跨岗位复用价值最高
  const groups = useMemo(() => {
    const uni = items.filter((i) => i.question.scope === "universal");
    const dom = items.filter((i) => i.question.scope === "domain");
    const rest = items.filter(
      (i) => i.question.scope !== "universal" && i.question.scope !== "domain"
    );
    return [
      { key: "universal", label: "Comes up everywhere", hint: "打磨一次，换岗位直接用", rows: uni },
      { key: "domain", label: "Domain-specific", hint: "每次都得重新想怎么从经历迁移", rows: dom },
      { key: "rest", label: "Unsorted", hint: "", rows: rest },
    ].filter((g) => g.rows.length > 0);
  }, [items]);

  const stats = useMemo(() => {
    let k = 0;
    let d = 0;
    for (const i of items) {
      const p = progressOf(i.answers);
      if (p === "keeper") k++;
      else if (p === "draft") d++;
    }
    return { keeper: k, draft: d, total: items.length };
  }, [items]);

  async function post(url: string, payload: unknown, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(answerId: number, status: "keeper" | "draft") {
    await fetch(`/api/answers/${answerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function adoptReusable() {
    if (!current?.reusable) return;
    await post(
      "/api/answers",
      {
        questionId: current.question.id,
        content: current.reusable.content,
        note: `复用自「${current.reusable.fromQuestionText}」的定稿`,
      },
      "adopt"
    );
  }

  return (
    <>
      {/* ── 岗位切换 + 出题 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => router.push(`/studio?role=${r.id}`)}
            className={`rounded-md border px-3 py-1.5 text-meta transition-colors ${
              r.id === activeRoleId
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {r.title}
          </button>
        ))}
        <button
          type="button"
          disabled={busy !== null || !activeRoleId}
          onClick={() => void post("/api/questions/generate", { roleId: activeRoleId }, "gen")}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "gen"
            ? "Writing questions…"
            : items.length > 0
              ? "Regenerate questions"
              : "Generate questions"}
        </button>
      </div>

      {/* ── Session 设置 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Session
        </p>
        <div className="flex items-center gap-1">
          {[
            { on: false, label: "One at a time", hint: "答一题 → 评点 → 再来" },
            { on: true, label: "Full chain", hint: "主问题 + 追问连着问完" },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              title={m.hint}
              onClick={() => {
                setChain(m.on);
                setChainStep(0);
              }}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                chain === m.on
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted-foreground hover:border-accent hover:text-accent"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="ml-auto font-mono text-meta text-muted-foreground">
          {stats.keeper} locked · {stats.draft} in progress · {stats.total} total
        </p>
      </div>

      {error && <p className="mb-4 text-meta text-accent">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
          No questions yet. Hit <span className="text-foreground">Generate questions</span> — Aceit
          reads the role, your stories, and your signals, then writes what this interview will
          actually ask.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          {/* ── 题目队列 ── */}
          <div className="space-y-4 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto lg:pr-1">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-1.5">
                  <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
                    {g.label}
                  </p>
                  {g.hint && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{g.hint}</p>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {g.rows.map(({ question, answers: rows, followUps, reusable }) => {
                    const active = question.id === current?.question.id;
                    const p = progressOf(rows);
                    const mark = PROGRESS_MARK[p];
                    return (
                      <li key={question.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(question.id);
                            setChainStep(0);
                          }}
                          className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                            active
                              ? "border-accent bg-accent-soft"
                              : "border-border bg-surface hover:border-accent"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`shrink-0 ${mark.tone}`} title={mark.label}>
                              {mark.mark}
                            </span>
                            <span className="min-w-0 text-meta text-foreground">
                              {question.text}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-pill px-2 py-0.5 font-mono text-[11px] ${
                                KIND_TONE[question.kind] ?? KIND_TONE.other
                              }`}
                            >
                              {question.kind}
                            </span>
                            {followUps.length > 0 && (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                +{followUps.length} follow-ups
                              </span>
                            )}
                            {reusable && (
                              <span className="rounded-pill bg-lemon px-2 py-0.5 font-mono text-[11px] text-lemon-ink">
                                reusable
                              </span>
                            )}
                            {rows.length > 0 && (
                              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                v{Math.max(...rows.map((a) => a.version))}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* ── 练习台 ── */}
          {current && asking && (
            <div className="space-y-5">
              {chain && chainQuestions.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
                  <p className="font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
                    Chain {chainStep + 1}/{chainQuestions.length}
                  </p>
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      disabled={chainStep === 0}
                      onClick={() => setChainStep((s) => s - 1)}
                      className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-35"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      disabled={chainStep >= chainQuestions.length - 1}
                      onClick={() => setChainStep((s) => s + 1)}
                      className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-35"
                    >
                      下一个追问 →
                    </button>
                  </div>
                </div>
              )}

              {/* 复用提示：同 cluster 已经有定稿 */}
              {!chain && current.reusable && (
                <div className="rounded-lg border border-lemon bg-lemon/30 px-4 py-3">
                  <p className="font-mono text-meta uppercase tracking-[0.1em] text-lemon-ink">
                    You already answered this one
                  </p>
                  <p className="mt-1 text-meta text-muted-foreground">
                    「{current.reusable.fromQuestionText}」的定稿可以直接拿来当起点。
                  </p>
                  <p className="mt-2 line-clamp-3 text-meta text-foreground">
                    {current.reusable.content}
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void adoptReusable()}
                    className="mt-2.5 rounded-md border border-lemon-ink/30 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-lemon-ink transition-opacity hover:opacity-70 disabled:opacity-40"
                  >
                    {busy === "adopt" ? "…" : "拿来当 v1"}
                  </button>
                </div>
              )}

              <VoicePractice
                question={{ id: asking.id, text: asking.text, scope: asking.scope }}
                onSaved={() => router.refresh()}
              />

              {/* ── 版本链 ── */}
              <div className="rounded-lg border border-border bg-surface p-5">
                <div className="flex items-baseline gap-3">
                  <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
                    Versions
                  </p>
                  <p className="ml-auto font-mono text-meta text-muted-foreground">
                    {versions.length === 0 ? "还没练过" : `${versions.length} takes`}
                  </p>
                </div>

                {versions.length === 0 ? (
                  <p className="mt-3 text-meta text-muted-foreground">
                    先用上面的语音练一遍，或者
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void post("/api/answers", { questionId: asking.id }, "draft")
                      }
                      className="ml-1 text-accent underline underline-offset-4 disabled:opacity-40"
                    >
                      {busy === "draft" ? "起草中…" : "让 Aceit 先起个草稿"}
                    </button>
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {[...versions].reverse().map((v) => (
                      <li
                        key={v.id}
                        className={`rounded-md border px-3.5 py-3 ${
                          v.status === "keeper"
                            ? "border-mint bg-mint/25"
                            : "border-border bg-surface-2"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-meta text-muted-foreground">
                            v{v.version}
                          </span>
                          {v.status === "keeper" && (
                            <span className="rounded-pill bg-mint px-2 py-0.5 font-mono text-[11px] text-mint-ink">
                              keeper
                            </span>
                          )}
                          {v.note && (
                            <span className="text-[12px] text-muted-foreground">{v.note}</span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void setStatus(v.id, v.status === "keeper" ? "draft" : "keeper")
                            }
                            className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
                          >
                            {v.status === "keeper" ? "取消定稿" : "设为定稿"}
                          </button>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-meta text-foreground">
                          {v.content}
                        </p>
                        {v.spokenTranscript && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent">
                              你当时是这么说的
                            </summary>
                            <p className="mt-1 border-l-2 border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
                              {v.spokenTranscript}
                            </p>
                          </details>
                        )}
                        {(() => {
                          const ids = JSON.parse(v.usedExperienceIds || "[]") as number[];
                          if (ids.length === 0) return null;
                          return (
                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                              用到的经历：
                              {ids.map((i) => experienceTitles[i]).filter(Boolean).join(" · ")}
                            </p>
                          );
                        })()}
                      </li>
                    ))}
                  </ul>
                )}

                {latest && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <input
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="想怎么改？比如「结果说具体点，把数字加上」"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || !instruction.trim()}
                      onClick={async () => {
                        const ok = await post(
                          `/api/answers/${latest.id}/refine`,
                          { instruction: instruction.trim() },
                          "refine"
                        );
                        if (ok) setInstruction("");
                      }}
                      className="rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {busy === "refine" ? "打磨中…" : "打磨"}
                    </button>
                  </div>
                )}

                {keeper && (
                  <p className="mt-3 font-mono text-[11px] text-mint-ink">
                    v{keeper.version} 是定稿。同类题（cluster {asking.clusterId ?? "—"}）
                    在别的岗位下会直接调用这一版。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
