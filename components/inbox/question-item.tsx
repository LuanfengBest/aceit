"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface AnswerRow {
  id: number;
  title: string;
  content: string;
  evidence: string | null;
  evidenceKind: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
}

export interface QuestionNode {
  id: number;
  text: string;
  /** 题本身的来源。没抽到答法的题也要能点回原文去看 */
  sourceUrl: string | null;
  sourceTitle: string | null;
  answers: AnswerRow[];
  followUps: { id: number; text: string; answers: AnswerRow[] }[];
}

/** 可选的落点，"一级 › 二级" */
export interface TaxonomyOption {
  l1: string;
  l2: string;
}

function Answers({
  rows,
  onGone,
}: {
  rows: AnswerRow[];
  onGone: (id: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {rows.map((a) => (
        <details key={a.id} className="group">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill bg-mint px-2.5 py-0.5 font-mono text-meta uppercase tracking-[0.1em] text-mint-ink transition-opacity hover:opacity-80">
            <span className="transition-transform group-open:rotate-90">›</span>
            How they answered
          </summary>
          <div className="mt-2 rounded-md border border-mint bg-mint/35 px-3.5 py-2.5">
            <div className="flex items-baseline gap-2">
              <p className="text-meta text-foreground">{a.title}</p>
              {a.sourceUrl && (
                <a
                  href={a.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto max-w-[16rem] shrink-0 truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                >
                  {a.sourceTitle || "原文"} ↗
                </a>
              )}
            </div>
            <p className="mt-1.5 text-meta text-muted-foreground">{a.content}</p>
            {a.evidence && (
              <div className="mt-2.5 border-t border-mint pt-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-mint-ink">
                  {a.evidenceKind === "image" ? "From image" : "From text"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                  {a.evidence}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => onGone(a.id)}
              className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
            >
              Delete this answer
            </button>
          </div>
        </details>
      ))}
    </div>
  );
}

export function QuestionItem({
  node,
  current,
  options,
}: {
  node: QuestionNode;
  current: TaxonomyOption;
  options: TaxonomyOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 用下标当 value：一级分类名里本来就带空格，
  // 拼成字符串再拆容易拆错，索引最省事
  const indexOfCurrent = Math.max(
    0,
    options.findIndex((o) => o.l1 === current.l1 && o.l2 === current.l2)
  );

  async function call(url: string, init: RequestInit) {
    setError(null);
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `请求失败（${res.status}）`);
      return false;
    }
    return true;
  }

  function move(value: string) {
    const target = options[Number(value)];
    if (!target) return;
    const { l1, l2 } = target;
    if (l1 === current.l1 && l2 === current.l2) return;
    start(async () => {
      const ok = await call(`/api/questions/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_l1: l1, topic: l2 }),
      });
      if (ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function removeQuestion() {
    start(async () => {
      const ok = await call(`/api/questions/${node.id}`, { method: "DELETE" });
      if (ok) router.refresh();
    });
  }

  function removeAnswer(id: number) {
    start(async () => {
      const ok = await call(`/api/insights/${id}`, { method: "DELETE" });
      if (ok) router.refresh();
    });
  }

  return (
    <li className="group/q">
      <div className="flex items-start gap-2">
        <p className="text-body">{node.text}</p>
        {node.sourceUrl && (
          <a
            href={node.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto max-w-[16rem] shrink-0 truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
          >
            {node.sourceTitle || "原文"} ↗
          </a>
        )}
        <div
          className={`flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover/q:opacity-100 focus-within:opacity-100 ${
            node.sourceUrl ? "" : "ml-auto"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setConfirming(false);
            }}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
          >
            {editing ? "Close" : "Move"}
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                onClick={removeQuestion}
                disabled={pending}
                className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent transition-opacity hover:opacity-70 disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setEditing(false);
              }}
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <p className="mt-1.5 text-meta text-muted-foreground">
          删掉这道题
          {node.followUps.length > 0 && `、它的 ${node.followUps.length} 条追问`}
          {node.answers.length + node.followUps.reduce((n, k) => n + k.answers.length, 0) >
            0 &&
            `、以及挂在上面的 ${
              node.answers.length +
              node.followUps.reduce((n, k) => n + k.answers.length, 0)
            } 条答法`}
          。重新 digest 这条素材会把它们再抽出来。
        </p>
      )}

      {editing && (
        <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <label className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Move to
          </label>
          <select
            defaultValue={String(indexOfCurrent)}
            onChange={(e) => move(e.target.value)}
            disabled={pending}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta text-foreground focus:border-accent focus:outline-none"
          >
            {options.map((o, i) => (
              <option key={`${o.l1}/${o.l2}`} value={String(i)}>
                {o.l1} › {o.l2}
              </option>
            ))}
          </select>
          {node.followUps.length > 0 && (
            <p className="mt-1.5 text-meta text-muted-foreground">
              {node.followUps.length} 条追问会跟着一起移动。
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-meta text-accent">{error}</p>}

      <Answers rows={node.answers} onGone={removeAnswer} />

      {node.followUps.length > 0 && (
        <ul className="mt-2.5 space-y-2.5 border-l border-border pl-4">
          {node.followUps.map((k) => (
            <li key={k.id} className="group/f">
              <div className="flex items-start gap-2">
                <p className="text-meta text-muted-foreground">↳ {k.text}</p>
                <button
                  type="button"
                  onClick={() =>
                    start(async () => {
                      const ok = await call(`/api/questions/${k.id}`, {
                        method: "DELETE",
                      });
                      if (ok) router.refresh();
                    })
                  }
                  className="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground opacity-0 transition-opacity hover:text-accent group-hover/f:opacity-100"
                >
                  Delete
                </button>
              </div>
              <Answers rows={k.answers} onGone={removeAnswer} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
