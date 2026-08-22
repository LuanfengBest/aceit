"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RoleProfile } from "@/lib/db/schema";

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function RoleCard({
  role,
  matchedKeywords,
}: {
  role: RoleProfile;
  matchedKeywords: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const responsibilities = parseList(role.responsibilities);
  const requirements = parseList(role.requirements);
  const niceToHave = parseList(role.niceToHave);
  const keywords = parseList(role.keywords);
  const matched = new Set(matchedKeywords);

  async function remove() {
    if (!confirm(`删除「${role.title}」？`)) return;
    setBusy(true);
    await fetch(`/api/roles/${role.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-section">{role.title}</h3>
          {role.company && (
            <p className="mt-0.5 text-meta text-muted-foreground">{role.company}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {open ? "收起" : "展开"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </div>

      {keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {keywords.map((kw) => {
            const hit = matched.has(kw);
            return (
              <span
                key={kw}
                title={hit ? "你的经历里有对应标签" : "素材里还没有对应经历"}
                className={`rounded-pill px-2.5 py-0.5 text-meta ${
                  hit
                    ? "bg-accent-soft text-accent"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {kw}
              </span>
            );
          })}
          <span className="ml-auto text-meta text-muted-foreground">
            {matched.size}/{keywords.length} 有对应经历
          </span>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <Block title="核心职责" items={responsibilities} />
          <Block title="硬性要求" items={requirements} />
          {niceToHave.length > 0 && <Block title="加分项" items={niceToHave} />}
          <details>
            <summary className="cursor-pointer text-meta text-muted-foreground">
              JD 原文
            </summary>
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-4 text-body">
              {role.rawJd}
            </p>
          </details>
        </div>
      )}
    </article>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-meta text-muted-foreground">{title}</h4>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-body">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
