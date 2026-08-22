"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RoleProfile } from "@/lib/db/schema";

export function DebriefForm({ roles }: { roles: RoleProfile[] }) {
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [roleId, setRoleId] = useState<number | null>(roles[0]?.id ?? null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; matched: number; unprepared: number } | null>(
    null
  );

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, roleId, interviewedAt: date || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDone(body);
      setTranscript("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-2 p-5">
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        disabled={busy}
        rows={7}
        placeholder={`趁还记得，把这场面试倒出来。流水账就行：\n\n先问了让我介绍一下自己，然后问 Cipher 那个项目知识库准确率怎么测的，我说了对照实验但没说清楚评测集…\n还问了如果数据源不稳定怎么办，这个没准备过，答得很虚。`}
        className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-accent disabled:opacity-60"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {roles.length > 0 && (
          <select
            value={roleId ?? ""}
            onChange={(e) => setRoleId(Number(e.target.value) || null)}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-meta outline-none focus:border-accent"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-meta outline-none focus:border-accent"
        />

        <button
          type="button"
          disabled={busy || transcript.trim().length < 20}
          onClick={() => void submit()}
          className="ml-auto rounded-md bg-accent px-4 py-2 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Matching to your library…" : "Log this round"}
        </button>
      </div>

      {error && <p className="mt-3 text-meta text-danger">{error}</p>}
      {done && (
        <p className="mt-3 text-meta">
          <span className="text-accent">
            {done.count} questions logged · {done.matched} matched
          </span>
          {done.unprepared > 0 && (
            <span className="text-danger"> · {done.unprepared} you had never prepared</span>
          )}
        </p>
      )}
    </section>
  );
}
