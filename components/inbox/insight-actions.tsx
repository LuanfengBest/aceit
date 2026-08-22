"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const KINDS = [
  { value: "pitfall", label: "Pitfall" },
  { value: "term", label: "Terminology" },
  { value: "company", label: "Company intel" },
  { value: "approach", label: "How to answer" },
] as const;

/**
 * Playbook 条目的编辑入口。
 * 这些条目没挂在题上，分组依据是 kind，所以"换位置"就是换 kind。
 */
export function InsightActions({
  id,
  kind,
}: {
  id: number;
  kind: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function call(init: RequestInit) {
    setError(null);
    const res = await fetch(`/api/insights/${id}`, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `请求失败（${res.status}）`);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <select
        defaultValue={kind}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await call({
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: e.target.value }),
            });
          })
        }
        className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-muted-foreground focus:border-accent focus:outline-none"
      >
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>

      {confirming ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => void (await call({ method: "DELETE" })))}
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
          onClick={() => setConfirming(true)}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          Delete
        </button>
      )}

      {error && <span className="text-meta text-accent">{error}</span>}
    </div>
  );
}
