"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DigestRow {
  id: number;
  title: string;
  status: "pending" | "processed" | "failed";
  type: "normal" | "video";
  imageCount: number;
  questionCount: number;
  insightCount: number;
}

const STATUS_TONE: Record<DigestRow["status"], string> = {
  pending: "bg-peach text-peach-ink",
  processed: "bg-mint text-mint-ink",
  failed: "bg-surface-2 text-danger",
};

const STATUS_LABEL: Record<DigestRow["status"], string> = {
  pending: "To digest",
  processed: "Digested",
  failed: "Failed",
};

export function DigestPanel({ rows }: { rows: DigestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const pending = rows.filter((r) => r.status !== "processed");

  async function digest(id: number) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${id}/digest`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLog((l) => [
        `#${id} ${body.company || "—"} · 读了 ${body.imagesRead} 张图 · ${body.questions} 题 / ${body.insights} 条知识`,
        ...l,
      ]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // 串行跑，避免一次打太多请求
  async function digestAll() {
    const ids = pending.map((r) => r.id);
    setQueue(ids);
    for (const id of ids) {
      await digest(id);
      setQueue((q) => q.filter((x) => x !== id));
    }
    setQueue([]);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Signals
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {rows.length} total · {pending.length} to digest
        </p>
        <button
          type="button"
          disabled={busy !== null || pending.length === 0}
          onClick={() => void digestAll()}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {queue.length > 0
            ? `Digesting… ${pending.length - queue.length}/${pending.length}`
            : `Digest all (${pending.length})`}
        </button>
      </div>

      {error && <p className="mb-3 text-meta text-danger">{error}</p>}

      {log.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-md border border-border bg-surface-2 p-4">
          {log.slice(0, 6).map((l, i) => (
            <li key={i} className="font-mono text-meta text-muted-foreground">
              {l}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full table-fixed border-collapse text-body">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-meta text-muted-foreground">
              <th className="px-5 py-2.5 font-normal">Source</th>
              <th className="w-20 px-5 py-2.5 font-normal">Type</th>
              <th className="w-24 px-5 py-2.5 font-normal">Status</th>
              <th className="w-20 px-5 py-2.5 font-normal">Qs</th>
              <th className="w-24 px-5 py-2.5 font-normal">Insights</th>
              <th className="w-24 px-5 py-2.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="h-row border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <td className="truncate px-5">{row.title}</td>
                <td className="px-5 text-meta text-muted-foreground">
                  {row.type === "video" ? "Video" : `${row.imageCount} imgs`}
                </td>
                <td className="px-5">
                  <span className={`rounded-pill px-2.5 py-0.5 text-meta ${STATUS_TONE[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td className="px-5 font-mono text-meta text-muted-foreground">
                  {row.questionCount || "—"}
                </td>
                <td className="px-5 font-mono text-meta text-muted-foreground">
                  {row.insightCount || "—"}
                </td>
                <td className="px-5 text-right">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void digest(row.id)}
                    className="rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                  >
                    {busy === row.id
                      ? "…"
                      : row.status === "processed"
                        ? "Redo"
                        : "Digest"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
