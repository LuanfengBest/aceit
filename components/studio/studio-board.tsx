"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Answer, Question, RoleProfile } from "@/lib/db/schema";

const KIND_LABEL: Record<Question["kind"], string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  case: "Case",
  resume: "Résumé",
  other: "Other",
};

const KIND_TONE: Record<Question["kind"], string> = {
  behavioral: "bg-mint text-mint-ink",
  technical: "bg-lavender text-lavender-ink",
  case: "bg-peach text-peach-ink",
  resume: "bg-lemon text-lemon-ink",
  other: "bg-surface-2 text-muted-foreground",
};

export interface QuestionWithAnswers {
  question: Question;
  answers: Answer[];
}

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

  const current = items.find((i) => i.question.id === selected) ?? items[0] ?? null;
  const versions = current ? [...current.answers].sort((a, b) => a.version - b.version) : [];
  const latest = versions[versions.length - 1] ?? null;

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

  if (roles.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
        No target role yet. Add a JD in <span className="text-foreground">Roles</span> first —
        questions are written against a specific role.
      </p>
    );
  }

  return (
    <>
      {/* 岗位切换 + 出题 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => router.push(`/studio?role=${role.id}`)}
            className={`rounded-pill px-3 py-1 text-meta transition-colors ${
              role.id === activeRoleId
                ? "bg-accent-soft text-accent"
                : "text-muted-foreground hover:bg-surface-2"
            }`}
          >
            {role.title}
          </button>
        ))}
        <button
          type="button"
          disabled={busy !== null || !activeRoleId}
          onClick={() => void post("/api/questions/generate", { roleId: activeRoleId }, "gen")}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "gen"
            ? "Writing questions…"
            : items.length > 0
              ? "Regenerate questions"
              : "Generate questions"}
        </button>
      </div>

      {error && <p className="mb-4 text-meta text-danger">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
          No questions yet. Hit <span className="text-foreground">Generate questions</span> — Aceit
          reads the role, your stories, and your signals, then writes what this interview will
          actually ask.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* 题目列表 */}
          <ul className="space-y-1.5 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
            {items.map(({ question, answers }) => {
              const active = question.id === current?.question.id;
              return (
                <li key={question.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(question.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      active
                        ? "border-accent bg-surface"
                        : "border-border bg-surface hover:border-text-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded-pill px-2 py-0.5 text-meta ${KIND_TONE[question.kind]}`}>
                        {KIND_LABEL[question.kind]}
                      </span>
                      {question.source === "inbox" && (
                        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-meta text-muted-foreground">
                          From the wild
                        </span>
                      )}
                      <span className="ml-auto font-mono text-meta text-muted-foreground">
                        {answers.length > 0 ? `v${answers.length}` : "—"}
                      </span>
                    </div>
                    <p className="mt-2 text-body">{question.text}</p>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* 答案区 */}
          {current && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="text-section">{current.question.text}</p>
              {current.question.rationale && (
                <p className="mt-2 text-meta text-muted-foreground">
                  Why they ask: {current.question.rationale}
                </p>
              )}
              {current.question.clusterId && (
                <p className="mt-1 font-mono text-meta text-muted-foreground">
                  cluster: {current.question.clusterId}
                </p>
              )}

              {!latest ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void post("/api/answers", { questionId: current.question.id }, "draft")
                  }
                  className="mt-5 rounded-md bg-accent px-4 py-2 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "draft" ? "Drafting from your stories…" : "Draft an answer"}
                </button>
              ) : (
                <>
                  <div className="mt-5 rounded-md border border-border bg-bg p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-mono text-meta text-accent">v{latest.version}</span>
                      {latest.note && (
                        <span className="text-meta text-muted-foreground">· {latest.note}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-body">{latest.content}</p>
                  </div>

                  {/* 这版用了哪几条经历 */}
                  {(() => {
                    const used = JSON.parse(latest.usedExperienceIds) as number[];
                    if (used.length === 0) return null;
                    return (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-meta text-muted-foreground">
                          BUILT FROM
                        </span>
                        {used.map((id) => (
                          <span
                            key={id}
                            className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-meta text-muted-foreground"
                          >
                            {experienceTitles[id] ?? `#${id}`}
                          </span>
                        ))}
                      </div>
                    );
                  })()}

                  {/* 打磨 */}
                  <div className="mt-5">
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={2}
                      placeholder="怎么改？比如：结果说得太虚，把具体数字提前；或者：太长了，压到 60 秒"
                      className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-body outline-none transition-colors focus:border-accent"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy !== null || instruction.trim().length === 0}
                        onClick={async () => {
                          const ok = await post(
                            `/api/answers/${latest.id}/refine`,
                            { instruction },
                            "refine"
                          );
                          if (ok) setInstruction("");
                        }}
                        className="rounded-md bg-accent px-4 py-2 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {busy === "refine" ? "Refining…" : "Refine into v" + (latest.version + 1)}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void post("/api/answers", { questionId: current.question.id }, "draft")
                        }
                        className="rounded-md px-3 py-2 text-meta text-muted-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
                      >
                        Start over
                      </button>
                    </div>
                  </div>

                  {/* 版本链 */}
                  {versions.length > 1 && (
                    <details className="mt-5">
                      <summary className="cursor-pointer font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
                        Version history ({versions.length})
                      </summary>
                      <ol className="mt-3 space-y-3 border-l border-border pl-4">
                        {versions
                          .slice()
                          .reverse()
                          .map((a) => (
                            <li key={a.id}>
                              <p className="font-mono text-meta text-muted-foreground">
                                v{a.version}
                                {a.note ? ` · ${a.note}` : ""}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-meta text-muted-foreground">
                                {a.content}
                              </p>
                            </li>
                          ))}
                      </ol>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
