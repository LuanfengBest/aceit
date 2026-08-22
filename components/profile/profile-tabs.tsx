"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Experience, ProfileDoc } from "@/lib/db/schema";
import { ExperienceCard } from "@/components/profile/experience-card";

const TYPE_LABEL: Record<ProfileDoc["type"], string> = {
  resume: "简历",
  experience: "经历叙述",
  other: "其他",
};

export interface DocRow {
  doc: ProfileDoc;
  fragmentCount: number;
}

export interface FragmentRow {
  experience: Experience;
  filename: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function formatDateTime(date: Date | null) {
  if (!date) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function ProfileTabs({
  fragments,
  docs,
}: {
  fragments: FragmentRow[];
  docs: DocRow[];
}) {
  const [tab, setTab] = useState<"fragments" | "docs">("fragments");

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-1">
        <TabButton active={tab === "fragments"} onClick={() => setTab("fragments")}>
          经历片段 {fragments.length}
        </TabButton>
        <TabButton active={tab === "docs"} onClick={() => setTab("docs")}>
          文档管理 {docs.length}
        </TabButton>
      </div>

      {tab === "fragments" ? (
        <FragmentList fragments={fragments} />
      ) : (
        <DocManager docs={docs} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-meta transition-colors ${
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FragmentList({ fragments }: { fragments: FragmentRow[] }) {
  if (fragments.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
        还没有经历片段。上传一份简历开始。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {fragments.map(({ experience, filename }) => (
        <ExperienceCard
          key={experience.id}
          experience={experience}
          source={filename ?? undefined}
        />
      ))}
    </div>
  );
}

function DocManager({ docs }: { docs: DocRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalFragments = docs.reduce((n, d) => n + d.fragmentCount, 0);

  async function remove(url: string, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (docs.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
        还没有上传过文档。
      </p>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full table-fixed border-collapse text-body">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-meta text-muted-foreground">
              <th className="px-5 py-2.5 font-normal">文件名</th>
              <th className="w-24 px-5 py-2.5 font-normal">类型</th>
              <th className="w-24 px-5 py-2.5 font-normal">原文字数</th>
              <th className="w-24 px-5 py-2.5 font-normal">片段数</th>
              <th className="w-36 px-5 py-2.5 font-normal">上传时间</th>
              <th className="w-16 px-5 py-2.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {docs.map(({ doc, fragmentCount }) => (
              <tr
                key={doc.id}
                className="h-row border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <td className="truncate px-5">{doc.filename}</td>
                <td className="px-5 text-meta text-muted-foreground">
                  {TYPE_LABEL[doc.type]}
                </td>
                <td className="px-5 text-meta text-muted-foreground">
                  {doc.rawText.length}
                </td>
                <td className="px-5 text-meta">
                  {fragmentCount === 0 ? (
                    <span className="text-danger">0</span>
                  ) : (
                    <span className="text-muted-foreground">{fragmentCount}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 text-meta text-muted-foreground">
                  {formatDateTime(doc.createdAt)}
                </td>
                <td className="px-5 text-right">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void remove(
                        `/api/profile/docs/${doc.id}`,
                        `删除《${doc.filename}》及其 ${fragmentCount} 条片段？`
                      )
                    }
                    className="rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {error ? (
          <p className="text-meta text-danger">{error}</p>
        ) : (
          <p className="text-meta text-muted-foreground">
            删除文档会连同它拆出的片段一起清掉，原文不可恢复
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void remove(
              "/api/profile/docs",
              `清空全部：${docs.length} 份文档 + ${totalFragments} 条片段。确定？`
            )
          }
          className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {busy ? "处理中…" : "清空全部素材"}
        </button>
      </div>
    </>
  );
}
