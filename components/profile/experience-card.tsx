"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Experience } from "@/lib/db/schema";

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export function ExperienceCard({
  experience,
  source,
}: {
  experience: Experience;
  source?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = parseTags(experience.tags);
  const sources = parseTags(experience.sources);
  // sources 为空是老数据（加这列之前入库的），回退到文档名
  const sourceLabel = sources.length > 0 ? sources.join(" + ") : source;

  const [draft, setDraft] = useState({
    title: experience.title,
    summary: experience.summary,
    detail: experience.detail,
    tags: tags.join("、"),
  });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiences/${experience.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          summary: draft.summary,
          detail: draft.detail,
          tags: draft.tags
            .split(/[、,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`删除「${experience.title}」？原文档不受影响。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiences/${experience.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <article className="rounded-lg border border-border bg-surface p-5">
        <div className="space-y-3">
          <Field label="标题">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-body outline-none focus:border-accent"
            />
          </Field>
          <Field label="摘要">
            <textarea
              value={draft.summary}
              rows={3}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-body outline-none focus:border-accent"
            />
          </Field>
          <Field label="完整叙述">
            <textarea
              value={draft.detail}
              rows={8}
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-body outline-none focus:border-accent"
            />
          </Field>
          <Field label="标签（顿号或逗号分隔）">
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-body outline-none focus:border-accent"
            />
          </Field>
        </div>

        {error && <p className="mt-3 text-meta text-danger">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft({
                title: experience.title,
                summary: experience.summary,
                detail: experience.detail,
                tags: tags.join("、"),
              });
              setEditing(false);
              setError(null);
            }}
            className="rounded-md px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-text-muted/30">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-section">{experience.title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          <CardAction onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "展开"}
          </CardAction>
          <CardAction onClick={() => setEditing(true)}>编辑</CardAction>
          <CardAction onClick={() => void remove()} disabled={busy} danger>
            删除
          </CardAction>
        </div>
      </div>

      <p className="mt-2 text-body text-muted-foreground">{experience.summary}</p>

      {(tags.length > 0 || sourceLabel) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-meta text-accent"
            >
              {tag}
            </span>
          ))}
          {sourceLabel && (
            <span className="ml-auto shrink-0 text-meta text-muted-foreground">
              来自 {sourceLabel}
              {sources.length > 1 && (
                <span className="ml-1.5 rounded-pill bg-accent-soft px-1.5 py-0.5 text-accent">
                  已合并
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-4">
          <p className="whitespace-pre-wrap text-body">{experience.detail}</p>
        </div>
      )}

      {error && <p className="mt-3 text-meta text-danger">{error}</p>}
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function CardAction({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2 py-1 text-meta transition-colors disabled:opacity-50 ${
        danger
          ? "text-muted-foreground hover:bg-surface-2 hover:text-danger"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
