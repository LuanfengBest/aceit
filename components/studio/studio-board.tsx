"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Answer, Question, RoleProfile } from "@/lib/db/schema";
import { VoicePractice } from "@/components/studio/voice-practice";
import { MockInterview } from "@/components/studio/mock-interview";
import { SupplementBox } from "@/components/studio/supplement-box";

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

const KIND_LABEL: Record<string, string> = {
  behavioral: "Behaviour & experience",
  technical: "Technical depth",
  case: "Scenarios",
  resume: "About your CV",
  other: "Other",
};

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
  experiences,
}: {
  roles: RoleProfile[];
  activeRole: RoleProfile | null;
  activeRoleId: number | null;
  items: QuestionWithAnswers[];
  experienceTitles: Record<number, string>;
  experiences: { id: number; title: string; chars: number }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(items[0]?.question.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  /**
   * 两种练法，不是一个页面里的开关，是两件不同的事：
   * practice —— 逐题打磨。题从库里来，一道一道抠，留版本链
   * mock     —— 模拟一整场。面试官顺着你的回答临场追问，走到哪儿算哪儿
   */
  const [mode, setMode] = useState<"practice" | "mock">("practice");
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  // 两大块一次只看一块。之前上下叠着放，通用那块 46 道题，
  // 要滚过全部才看得到岗位那块，等于没分开
  const [block, setBlock] = useState<"universal" | "role">("universal");
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const current = items.find((i) => i.question.id === selected) ?? items[0] ?? null;

  const asking = current?.question;

  const askingAnswers =
    asking && current
      ? asking.id === current.question.id
        ? current.answers
        : (current.followUps.find((f) => f.question.id === asking.id)?.answers ?? [])
      : [];
  const versions = [...askingAnswers].sort((a, b) => a.version - b.version);
  const latest = versions[versions.length - 1] ?? null;
  const keeper = versions.find((v) => v.status === "keeper") ?? null;

  /**
   * 队列分两大块，块内再按标签细分：
   * - 通用块按 kind 分（自我介绍那类行为题 / 技术题 / 场景题…），
   *   这些标签是固定的，因为「问的是这个人」这件事不随岗位变
   * - 岗位块按业务域标签分（AI导购 / AI搜索 / 内容生成…），
   *   这些标签跟着你粘的 JD 走，换个岗位就换一批
   */
  const sections = useMemo(() => {
    const match = (i: QuestionWithAnswers) =>
      kindFilter.size === 0 || kindFilter.has(i.question.kind);

    const universal = items.filter((i) => i.bucket === "universal" && match(i));
    const roleSide = items.filter((i) => i.bucket !== "universal" && match(i));

    const groupBy = (
      rows: QuestionWithAnswers[],
      key: (i: QuestionWithAnswers) => string
    ) => {
      const m = new Map<string, QuestionWithAnswers[]>();
      for (const r of rows) {
        const k = key(r);
        m.set(k, [...(m.get(k) ?? []), r]);
      }
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    };

    return [
      {
        key: "universal" as const,
        tab: "Every interview",
        tabNote: "Same for every role",
        note: "Asked no matter which role you apply to — who you are, what you have done, how you work. Polish these once and they carry over. Grouped by what the question tests.",
        empty: "Nothing here yet. Hit “Write universal set” above.",
        total: universal.length,
        // 通用题按题型分：这些标签不随岗位变。
        // 小标题已经是题型了，卡片上就不再挂 kind 标签，那是重复
        showKind: false,
        groups: groupBy(universal, (i) => KIND_LABEL[i.question.kind] ?? "Other"),
      },
      {
        key: "role" as const,
        tab: activeRole ? activeRole.title : "This role",
        tabNote: "Changes with the role",
        note: activeRole?.domain
          ? `Only for ${activeRole.domain}. Switch roles at the top and this whole block changes. Grouped by business area.`
          : "Everything this JD names. Switch roles at the top and this whole block changes. Grouped by business area.",
        empty: "Nothing for this role yet. Hit “Write role set” above.",
        total: roleSide.length,
        // 岗位题按业务域分，题型不是分组依据，所以卡片上留着 kind 标签
        showKind: true,
        groups: groupBy(roleSide, (i) => i.question.topic ?? "Unsorted"),
      },
    ];
  }, [items, activeRole, kindFilter]);

  const shown = sections.find((sec) => sec.key === block) ?? sections[0];

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

  /** 改题的归属：在通用/岗位之间搬，或换业务域标签 */
  async function moveQuestion(id: number, payload: Record<string, unknown>) {
    setBusy(`move-${id}`);
    try {
      await fetch(`/api/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteQuestion(id: number) {
    setBusy(`del-${id}`);
    try {
      await fetch(`/api/questions/${id}`, { method: "DELETE" });
      if (selected === id) setSelected(null);
      setConfirming(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /** 可搬到的业务域标签：白名单里的 + 现在已经在用的 */
  const topicChoices = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.question.topic) set.add(i.question.topic);
    return [...set].sort();
  }, [items]);

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
        note: `Reused from the locked answer to "${current.reusable.fromQuestionText}"`,
      },
      "adopt"
    );
  }

  return (
    <>
      {/* ── 两种练法 ── */}
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        {(
          [
            {
              key: "practice" as const,
              title: "Practice",
              sub: "One question at a time",
              desc: "Questions from your bank. Every take is kept, so you can hear which version was better.",
            },
            {
              key: "mock" as const,
              title: "Mock interview",
              sub: "A full session, start to finish",
              desc: "Paste a JD or pick a role. The interviewer follows your answers and digs in.",
            },
          ]
        ).map((m) => {
          const on = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                on
                  ? "border-accent bg-accent-soft"
                  : "border-border bg-surface hover:border-accent"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className={`text-section ${on ? "text-accent" : "text-foreground"}`}>
                  {m.title}
                </span>
                <span
                  className={`font-mono text-[11px] uppercase tracking-[0.1em] ${
                    on ? "text-accent/70" : "text-muted-foreground"
                  }`}
                >
                  {m.sub}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {m.desc}
              </p>
            </button>
          );
        })}
      </div>

      {mode === "mock" ? (
        <MockInterview roles={roles.map((r) => ({ id: r.id, title: r.title }))} />
      ) : (
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
            title="Questions every interview asks — not tied to any role"
            onClick={() => void post("/api/questions/generate", {}, "gen-uni")}
            className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {busy === "gen-uni" ? "Writing…" : "Write universal set"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !activeRoleId}
            title="Only what this role and its domain will ask"
            onClick={() => void post("/api/questions/generate", { roleId: activeRoleId }, "gen")}
            className="rounded-md bg-accent px-3 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "gen" ? "Writing…" : "Write role set"}
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
              Source JDs →
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
                Where the JDs differ
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

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Progress
        </p>
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
            Clear
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
        <div className="grid gap-5 lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
          {/* ── 题目队列 ── */}
          <div className="space-y-4 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto lg:pr-1">
            <SupplementBox roleId={activeRoleId} experiences={experiences} />

            {/* 两大块的切换。一次只看一块 */}
            <div className="grid grid-cols-2 gap-1.5">
              {sections.map((sec) => {
                const on = sec.key === block;
                const ink = sec.key === "universal" ? "lavender" : "peach";
                return (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => setBlock(sec.key as "universal" | "role")}
                    className={`rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                      on
                        ? ink === "lavender"
                          ? "border-lavender-ink/45 bg-lavender"
                          : "border-peach-ink/45 bg-peach"
                        : "border-border bg-surface hover:border-accent"
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-meta font-semibold ${
                          on
                            ? ink === "lavender"
                              ? "text-lavender-ink"
                              : "text-peach-ink"
                            : "text-foreground"
                        }`}
                      >
                        {sec.tab}
                      </span>
                      <span
                        className={`ml-auto font-mono text-meta ${
                          on
                            ? ink === "lavender"
                              ? "text-lavender-ink"
                              : "text-peach-ink"
                            : "text-muted-foreground"
                        }`}
                      >
                        {sec.total}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {sec.tabNote}
                    </p>
                  </button>
                );
              })}
            </div>

            {shown && (
              <div>
                <p className="mb-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  {shown.note}
                </p>

                {shown.total === 0 ? (
                  <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-meta text-muted-foreground">
                    {shown.empty}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {shown.groups.map(([tag, rows]) => (
                      <div key={tag}>
                        <div className="mb-1 flex items-baseline gap-2 border-b border-border pb-1">
                          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                            {tag}
                          </span>
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                            {rows.length}
                          </span>
                        </div>
                        <ul className="space-y-1.5 pt-1.5">
                          {rows.map(({ question, answers: rowAnswers, followUps, reusable }) => {
                            const active = question.id === current?.question.id;
                            const p = progressOf(rowAnswers);
                            const mark = PROGRESS_MARK[p];
                            return (
                              <li key={question.id} className="group/row">
                                <button
                                  type="button"
                                  onClick={() => setSelected(question.id)}
                                  className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                                    active
                                      ? "border-accent bg-accent-soft"
                                      : "border-border bg-surface hover:border-accent"
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={`shrink-0 ${mark.tone}`}
                                      title={mark.label}
                                    >
                                      {mark.mark}
                                    </span>
                                    <span className="min-w-0 text-meta text-foreground">
                                      {question.text}
                                    </span>
                                  </div>
                                  {(followUps.length > 0 ||
                                    reusable ||
                                    rowAnswers.length > 0 ||
                                    shown.showKind) && (
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      {/* 通用块的小标题已经是题型了，卡片上再挂一次是重复 */}
                                      {shown.showKind && (
                                        <span
                                          className={`rounded-pill px-2 py-0.5 font-mono text-[11px] ${
                                            KIND_TONE[question.kind] ?? KIND_TONE.other
                                          }`}
                                        >
                                          {question.kind}
                                        </span>
                                      )}
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
                                      {rowAnswers.length > 0 && (
                                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                          v{Math.max(...rowAnswers.map((a) => a.version))}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </button>

                                {/* 改归属 / 删除。默认藏着，悬停才出来 */}
                                <div className="mt-1 flex items-center gap-2 pl-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditing(editing === question.id ? null : question.id)
                                    }
                                    className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
                                  >
                                    {editing === question.id ? "Close" : "Move"}
                                  </button>
                                  {confirming === question.id ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() => void deleteQuestion(question.id)}
                                        className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent transition-opacity hover:opacity-70 disabled:opacity-40"
                                      >
                                        Confirm delete
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirming(null)}
                                        className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirming(question.id)}
                                      className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>

                                {editing === question.id && (
                                  <div className="mt-1.5 space-y-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                        Block
                                      </span>
                                      <button
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() =>
                                          void moveQuestion(question.id, { scope: "universal" })
                                        }
                                        className={`rounded-pill px-2 py-0.5 font-mono text-[10px] transition-opacity ${
                                          question.scope === "universal"
                                            ? "bg-lavender text-lavender-ink"
                                            : "border border-border text-muted-foreground hover:border-accent"
                                        }`}
                                      >
                                        Every interview
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy !== null || !activeRoleId}
                                        onClick={() =>
                                          void moveQuestion(question.id, {
                                            scope: "domain",
                                            role_id: activeRoleId,
                                          })
                                        }
                                        className={`rounded-pill px-2 py-0.5 font-mono text-[10px] transition-opacity ${
                                          question.scope === "domain"
                                            ? "bg-peach text-peach-ink"
                                            : "border border-border text-muted-foreground hover:border-accent"
                                        } disabled:opacity-40`}
                                      >
                                        This role
                                      </button>
                                    </div>
                                    {topicChoices.length > 0 && (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                          Area
                                        </span>
                                        <select
                                          defaultValue={question.topic ?? ""}
                                          disabled={busy !== null}
                                          onChange={(e) =>
                                            void moveQuestion(question.id, {
                                              topic: e.target.value,
                                            })
                                          }
                                          className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] text-foreground focus:border-accent focus:outline-none"
                                        >
                                          <option value="">—</option>
                                          {topicChoices.map((t) => (
                                            <option key={t} value={t}>
                                              {t}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 练习台 ── */}
          {current && asking && (
            <div className="space-y-5">
              {/* 复用提示：同 cluster 已经有定稿 */}
              {current.reusable && (
                <div className="rounded-lg border border-lemon bg-lemon/30 px-4 py-3">
                  <p className="font-mono text-meta uppercase tracking-[0.1em] text-lemon-ink">
                    You already answered this one
                  </p>
                  <p className="mt-1 text-meta text-muted-foreground">
                    You already locked an answer to &ldquo;{current.reusable.fromQuestionText}&rdquo;. Start from it.
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
                    {busy === "adopt" ? "…" : "Use as v1"}
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
                    {versions.length === 0 ? "Not practised yet" : `${versions.length} takes`}
                  </p>
                </div>

                {versions.length === 0 ? (
                  <p className="mt-3 text-meta text-muted-foreground">
                    Practise it out loud above, or 
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void post("/api/answers", { questionId: asking.id }, "draft")
                      }
                      className="ml-1 text-accent underline underline-offset-4 disabled:opacity-40"
                    >
                      {busy === "draft" ? "Drafting…" : "let Aceit draft one first"}
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
                            {v.status === "keeper" ? "Unlock" : "Lock this one"}
                          </button>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-meta text-foreground">
                          {v.content}
                        </p>
                        {v.spokenTranscript && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent">
                              What you actually said
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
                              Drew on: 
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
                      placeholder="What should change? e.g. &quot;make the result concrete, put the numbers in&quot;"
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
                      {busy === "refine" ? "Refining…" : "Refine"}
                    </button>
                  </div>
                )}

                {keeper && (
                  <p className="mt-3 font-mono text-[11px] text-mint-ink">
                    v{keeper.version} is locked. Questions in the same cluster (
                    {asking.clusterId ?? "—"}) will pull this version under other roles.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </>
  );
}
