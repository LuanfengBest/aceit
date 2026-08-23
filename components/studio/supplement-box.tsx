"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 补题。
 *
 * 出题不该是一次性的黑盒——铺完一批之后，总有你觉得没问透的地方。
 * 这里你直接说要什么，出来的题先摆着让你挑，收了才进题库。
 *
 * 聚焦到某一条经历时会给模型**全文**（铺一批时每条只给 1500 字，
 * 一万五千字的项目只露了个开头，问不出里面的技术决策）。
 */

interface Suggested {
  text: string;
  kind: string;
  scope: "universal" | "domain";
  rationale: string | null;
  cluster: string | null;
  follows: number | null;
}

const PRESETS = [
  "这段经历问得太浅了，针对里面的技术决策再来五道",
  "出几道逼我讲清楚数字怎么来的",
  "这个岗位要求我没做过的东西，出几道逼我想迁移路径的",
  "加几道问我跟别的团队怎么吵架、怎么推动的",
];

export function SupplementBox({
  roleId,
  experiences,
}: {
  roleId: number | null;
  experiences: { id: number; title: string; chars: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [focus, setFocus] = useState<number | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Suggested[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  async function run() {
    if (instruction.trim().length < 2) return;
    setBusy("run");
    setError(null);
    setRows(null);
    setNote(null);
    try {
      const res = await fetch("/api/questions/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: instruction.trim(),
          roleId,
          experienceId: focus === "" ? null : focus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not write questions");
      setRows(data.questions ?? []);
      setNote(data.note ?? null);
      // 默认全选：多数时候是想全收的，取消比逐个勾快
      setPicked(new Set((data.questions ?? []).map((_: unknown, i: number) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!rows) return;
    // 追问的 follows 指向原数组下标，挑选后会错位，先重新编号
    const keep = rows.map((r, i) => ({ r, i })).filter(({ i }) => picked.has(i));
    const remap = new Map(keep.map(({ i }, n) => [i, n] as const));
    const payload = keep.map(({ r }) => ({
      ...r,
      follows:
        r.follows !== null && remap.has(r.follows) ? (remap.get(r.follows) ?? null) : null,
    }));
    if (payload.length === 0) return;

    setBusy("save");
    try {
      await fetch("/api/questions/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: payload, roleId }),
      });
      setRows(null);
      setNote(null);
      setInstruction("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 w-full rounded-lg border border-dashed border-border px-4 py-2.5 text-left transition-colors hover:border-accent"
      >
        <span className="font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
          + Ask for more questions
        </span>
        <span className="ml-2 text-meta text-muted-foreground">
          Tell Aceit what is missing — it writes them, you keep the ones worth practising.
        </span>
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <p className="font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
          Ask for more questions
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          Close
        </button>
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={2}
        placeholder="What is missing? e.g. “LLM-Wiki 那段问得太浅，针对读写分离和为什么不用纯 RAG 再来五道”"
        className="w-full rounded-md border border-border bg-surface px-3.5 py-2 text-meta text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Dig into
        </span>
        <select
          value={String(focus)}
          onChange={(e) => setFocus(e.target.value === "" ? "" : Number(e.target.value))}
          className="min-w-0 max-w-[22rem] rounded-md border border-border bg-surface px-2.5 py-1 text-meta text-foreground focus:border-accent focus:outline-none"
        >
          <option value="">Everything in my record</option>
          {experiences.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}（{e.chars} 字）
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy !== null || instruction.trim().length < 2}
          onClick={() => void run()}
          className="ml-auto rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy === "run" ? "Writing…" : "Write them"}
        </button>
      </div>

      {focus !== "" && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Focusing on one story sends its full text — the batch generator only ever sees the
          first 1,500 characters of each.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setInstruction(p)}
            className="rounded-pill border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
          >
            {p}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-meta text-accent">{error}</p>}

      {rows && (
        <div className="mt-3.5 border-t border-border pt-3">
          {note && <p className="mb-2.5 text-meta text-muted-foreground">{note}</p>}
          {rows.length === 0 ? (
            <p className="text-meta text-muted-foreground">Nothing came back. Try rewording.</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {rows.map((q, i) => (
                  <li key={i}>
                    <label
                      className={`flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                        picked.has(i)
                          ? "border-accent bg-accent-soft"
                          : "border-border bg-surface-2"
                      } ${q.follows !== null ? "ml-6" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(i)}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className="mt-1 shrink-0 accent-[var(--accent)]"
                      />
                      <div className="min-w-0">
                        <p className="text-meta text-foreground">
                          {q.follows !== null && (
                            <span className="text-muted-foreground">↳ </span>
                          )}
                          {q.text}
                        </p>
                        {q.rationale && (
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {q.rationale}
                          </p>
                        )}
                      </div>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                        {q.scope === "universal" ? "every" : "role"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)))
                  }
                  className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
                >
                  {picked.size === rows.length ? "Clear all" : "Select all"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || picked.size === 0}
                  onClick={() => void save()}
                  className="ml-auto rounded-md bg-accent px-3.5 py-1.5 text-meta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "save" ? "Saving…" : `Keep ${picked.size}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
