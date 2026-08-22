"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DOC_TYPES = [
  { value: "resume", label: "简历" },
  { value: "experience", label: "经历叙述" },
  { value: "other", label: "其他" },
] as const;

const ACCEPT = ".md,.txt,.pdf,.docx";

type FileState =
  | { status: "waiting" }
  | { status: "working" }
  | { status: "done"; count: number; chars: number }
  | { status: "error"; message: string };

interface Row {
  name: string;
  state: FileState;
}

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<string>("resume");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  function patchRow(index: number, state: FileState) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, state } : row))
    );
  }

  // 一个文件一个请求，串行跑：这样每份的进度能单独显示，
  // 也避免一个大文件把整批请求拖超时
  async function uploadAll(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setRows(files.map((f) => ({ name: f.name, state: { status: "waiting" } })));

    for (let i = 0; i < files.length; i++) {
      patchRow(i, { status: "working" });

      const form = new FormData();
      form.append("file", files[i]);
      form.append("type", type);

      try {
        const res = await fetch("/api/profile/upload", {
          method: "POST",
          body: form,
        });
        const body = await res.json();
        if (!res.ok) {
          patchRow(i, {
            status: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
        } else {
          patchRow(i, {
            status: "done",
            count: body.count,
            chars: body.chars,
          });
        }
      } catch (err) {
        patchRow(i, {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      router.refresh();
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void uploadAll([...e.dataTransfer.files]);
      }}
      className={`rounded-lg border bg-surface-2 p-5 transition-colors ${
        dragging ? "border-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {DOC_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={busy}
              onClick={() => setType(t.value)}
              className={`rounded-pill px-3 py-1 text-meta transition-colors disabled:opacity-50 ${
                type === t.value
                  ? "bg-accent-soft text-accent"
                  : "text-muted-foreground hover:bg-surface"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-meta text-muted-foreground">拖进来，或者</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "处理中…" : "选择文件"}
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => void uploadAll([...(e.target.files ?? [])])}
      />

      <p className="mt-3 text-meta text-muted-foreground">
        支持 .md / .txt / .pdf / .docx，可一次选多份 —— 上传后自动拆成经历片段
      </p>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((row, i) => (
            <li
              key={`${row.name}-${i}`}
              className="flex items-baseline justify-between gap-4 text-meta"
            >
              <span className="truncate">{row.name}</span>
              <span className="shrink-0">
                <RowStatus state={row.state} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RowStatus({ state }: { state: FileState }) {
  switch (state.status) {
    case "waiting":
      return <span className="text-muted-foreground">排队中</span>;
    case "working":
      return <span className="text-muted-foreground">解析拆解中…</span>;
    case "done":
      return (
        <span className="text-accent">
          {state.chars} 字 · {state.count} 条片段
        </span>
      );
    case "error":
      return <span className="text-danger">{state.message}</span>;
  }
}
