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
  /** universal 全局共享 · role 本岗位专属 · wild 面经里的领域题 */
  bucket: "universal" | "role" | "wild";
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
  activeRole,
  activeRoleId,
  items,
  experienceTitles,
}: {
  roles: RoleProfile[];
  activeRole: RoleProfile | null;
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
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());

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

  // 队列按「跟不跟岗位走」分组，不是按 scope。
  // 通用题切岗位时不动——投哪个岗都会问，重复练没意义
  const groups = useMemo(() => {
    const pick = (b: QuestionWithAnswers["bucket"]) =>
      items.filter(
        (i) =>
          i.bucket === b &&
          (kindFilter.size === 0 || kindFilter.has(i.question.kind))
      );
    return [
      {
        key: "universal",
        label: "通用题",
        sub: "Asked in every interview",
        hint: "自我介绍、经历深挖、协作冲突。**切岗位时这一组不变**，打磨一次到处能用。",
        tone: "lavender" as const,
        pinned: true,
        rows: pick("universal"),
      },
      {
        key: "role",
        label: "岗位专属",
        sub: activeRole ? activeRole.title : "Role-specific",
        hint: activeRole?.domain
          ? `绑定业务域：${activeRole.domain}。**切岗位这一组会整个换掉。**`
          : "这份 JD 点名的场景和技术栈。**切岗位这一组会整个换掉。**",
        tone: "peach" as const,
        pinned: false,
        rows: pick("role"),
      },
      {
        key: "wild",
        label: "面经里的领域题",
        sub: "From the wild",
        hint: "别人真被问过、但还没归到任何岗位画像下的领域题。",
        tone: "mint" as const,
        pinned: false,
        rows: pick("wild"),
      },
    ].filter((g) => g.rows.length > 0);
  }, [items, activeRole, kindFilter]);

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
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            title="出跨岗位都会问的题，不绑任何岗位"
            onClick={() => void post("/api/questions/generate", {}, "gen-uni")}
            className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {busy === "gen-uni" ? "出通用题…" : "出通用题"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !activeRoleId}
            title="只出这个岗位/业务域专属的题"
            onClick={() => void post("/api/questions/generate", { roleId: activeRoleId }, "gen")}
            className="rounded-md bg-accent px-3 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "gen" ? "出岗位题…" : "出本岗位的题"}
          </button>
        </div>
      </div>

      {/* ── 这个岗位在关注什么：从 JD 提炼出来的，出题就是照着这些出的 ── */}
      {activeRole && (
        <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
              What this role cares about
            </p>
            {activeRole.domain && (
              <span className="rounded-pill bg-peach px-2 py-0.5 font-mono text-[11px] text-peach-ink">
                {activeRole.domain}
              </span>
            )}
            <a
              href="/roles"
              className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
            >
              JD 原文 →
            </a>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(JSON.parse(activeRole.keywords || "[]") as string[]).slice(0, 14).map((k) => (
              <span
                key={k}
                className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-meta text-muted-foreground"
              >
                {k}
              </span>
            ))}
          </div>
          {(JSON.parse(activeRole.variance || "[]") as string[]).length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent">
                各家的差异点
              </summary>
              <ul className="mt-1.5 space-y-1">
                {(JSON.parse(activeRole.variance || "[]") as string[]).map((v) => (
                  <li key={v} className="text-meta text-muted-foreground">
                    · {v}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ── Session 设置 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Session
        </p>
        <div className="flex items-center gap-1">
          {[
            {
              on: false,
              label: "逐题",
              hint: "答一题，立刻评点，改完再答下一题。适合打磨单题",
            },
            {
              on: true,
              label: "连击",
              hint: "主问题答完直接进追问，像真实面试一样被一路追着问",
            },
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

      {/* ── 按类型筛 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Filter
        </p>
        {(["behavioral", "technical", "case", "resume", "other"] as const).map((k) => {
          const n = items.filter((i) => i.question.kind === k).length;
          if (n === 0) return null;
          const on = kindFilter.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() =>
                setKindFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                })
              }
              className={`rounded-pill px-2.5 py-0.5 font-mono text-[11px] transition-opacity ${
                KIND_TONE[k]
              } ${on ? "" : "opacity-40 hover:opacity-70"}`}
            >
              {k} {n}
            </button>
          );
        })}
        {kindFilter.size > 0 && (
          <button
            type="button"
            onClick={() => setKindFilter(new Set())}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
          >
            清除
          </button>
        )}
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
              <div
                key={g.key}
                className={`rounded-xl border-l-4 pl-3 ${
                  g.tone === "lavender"
                    ? "border-lavender-ink/45"
                    : g.tone === "peach"
                      ? "border-peach-ink/45"
                      : "border-mint-ink/45"
                }`}
              >
                <div
                  className={`mb-2 rounded-lg px-3 py-2.5 ${
                    g.tone === "lavender"
                      ? "bg-lavender"
                      : g.tone === "peach"
                        ? "bg-peach"
                        : "bg-mint"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <p
                      className={`text-section ${
                        g.tone === "lavender"
                          ? "text-lavender-ink"
                          : g.tone === "peach"
                            ? "text-peach-ink"
                            : "text-mint-ink"
                      }`}
                    >
                      {g.label}
                    </p>
                    {g.pinned && (
                      <span className="rounded-pill border border-lavender-ink/35 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-lavender-ink">
                        pinned
                      </span>
                    )}
                    <span
                      className={`font-mono text-[11px] uppercase tracking-[0.1em] opacity-70 ${
                        g.tone === "lavender"
                          ? "text-lavender-ink"
                          : g.tone === "peach"
                            ? "text-peach-ink"
                            : "text-mint-ink"
                      }`}
                    >
                      {g.sub}
                    </span>
                    <span
                      className={`ml-auto font-mono text-meta ${
                        g.tone === "lavender"
                          ? "text-lavender-ink"
                          : g.tone === "peach"
                            ? "text-peach-ink"
                            : "text-mint-ink"
                      }`}
                    >
                      {g.rows.length}
                    </span>
                  </div>
                  {g.hint && (
                    <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">
                      {g.hint.split("**").map((part, i) =>
                        i % 2 === 1 ? (
                          <strong key={i} className="font-semibold text-foreground">
                            {part}
                          </strong>
                        ) : (
                          <span key={i}>{part}</span>
                        )
                      )}
                    </p>
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
