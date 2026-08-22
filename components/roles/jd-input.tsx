"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JdInput() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setJd("");
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
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        disabled={busy}
        rows={6}
        placeholder="把 JD 整段粘进来，包括职责和要求"
        className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-accent disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-meta text-muted-foreground">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : (
            "抽出职责、硬性要求、加分项和能力关键词"
          )}
        </p>
        <button
          type="button"
          disabled={busy || jd.trim().length < 30}
          onClick={() => void submit()}
          className="rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "抽取中…" : "生成岗位画像"}
        </button>
      </div>
    </section>
  );
}
