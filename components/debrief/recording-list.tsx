"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 录好的面试，以及它们走到了哪一步。
 * recorded → transcribed → debriefed，每一步都能单独重跑：
 * 转写要几分钟，复盘要调模型，中间挂了不该从头再来。
 */

interface Row {
  id: number;
  company: string | null;
  round: string | null;
  status: string;
  error: string | null;
  bytes: number;
  durationSeconds: number | null;
  transcript: string | null;
  interviewedAt: string | null;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  recorded: { label: "Recorded", tone: "bg-surface-2 text-muted-foreground" },
  transcribed: { label: "Transcribed", tone: "bg-lemon text-lemon-ink" },
  debriefed: { label: "Debriefed", tone: "bg-mint text-mint-ink" },
  failed: { label: "Failed", tone: "bg-peach text-peach-ink" },
};

export function RecordingList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (rows.length === 0) return null;

  async function call(id: number, step: "transcribe" | "debrief") {
    setBusy(`${step}-${id}`);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/recordings/${id}/${step}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "出错了");
      if (step === "debrief") {
        setResult(
          `问了 ${data.asked} 道 · 题库里已有 ${data.matched} 道 · 新补进去 ${data.newToTheBank} 道`
        );
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {error && <p className="text-meta text-accent">{error}</p>}
      {result && (
        <p className="rounded-md border border-mint bg-mint/30 px-3.5 py-2.5 text-meta text-mint-ink">
          {result}
        </p>
      )}

      {rows.map((r) => {
        const st = STATUS[r.status] ?? STATUS.recorded;
        const mins = r.durationSeconds ? Math.round(r.durationSeconds / 60) : null;
        return (
          <div key={r.id} className="rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`rounded-pill px-2.5 py-0.5 font-mono text-[11px] ${st.tone}`}>
                {st.label}
              </span>
              <span className="text-meta text-foreground">
                {[r.company, r.round].filter(Boolean).join(" · ") || `Recording ${r.id}`}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {mins !== null ? `${mins} min · ` : ""}
                {(r.bytes / 1024 / 1024).toFixed(1)} MB
                {r.interviewedAt ? ` · ${r.interviewedAt}` : ""}
              </span>

              <div className="ml-auto flex items-center gap-1.5">
                {r.transcript && (
                  <button
                    type="button"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    className="rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
                  >
                    {open === r.id ? "Hide" : "Transcript"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void call(r.id, "transcribe")}
                  className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {busy === `transcribe-${r.id}`
                    ? "…"
                    : r.transcript
                      ? "Redo transcript"
                      : "Transcribe"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || !r.transcript}
                  onClick={() => void call(r.id, "debrief")}
                  className="rounded-md bg-accent px-3 py-1 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy === `debrief-${r.id}`
                    ? "…"
                    : r.status === "debriefed"
                      ? "Redo breakdown"
                      : "Break it down"}
                </button>
              </div>
            </div>

            {r.error && <p className="mt-1.5 text-meta text-peach-ink">{r.error}</p>}

            {open === r.id && r.transcript && (
              <div className="mt-2.5 border-t border-border pt-2.5">
                <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  Whisper transcript · {r.transcript.length} 字
                </p>
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-meta text-muted-foreground">
                  {r.transcript}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
