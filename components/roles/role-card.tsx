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

export interface RoleJdRow {
  id: number;
  company: string | null;
  title: string | null;
  rawJd: string;
}

export function RoleCard({
  role,
  matchedKeywords,
  jds,
}: {
  role: RoleProfile;
  matchedKeywords: string[];
  /** 这个画像底下挂的 JD 原文。聚合是有损的，原文得能翻回去看 */
  jds: RoleJdRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openJd, setOpenJd] = useState<number | null>(null);

  const responsibilities = parseList(role.responsibilities);
  const requirements = parseList(role.requirements);
  const niceToHave = parseList(role.niceToHave);
  const keywords = parseList(role.keywords);
  const variance = parseList(role.variance);
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
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-section">{role.title}</h3>
            <span
              className={`rounded-pill px-2 py-0.5 font-mono text-[11px] ${
                role.kind === "domain"
                  ? "bg-peach text-peach-ink"
                  : "bg-lavender text-lavender-ink"
              }`}
            >
              {role.kind === "domain" ? (role.domain ?? "特定业务域") : "通用型"}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {jds.length} 份 JD
            </span>
          </div>
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
          {variance.length > 0 && (
            <div>
              <h4 className="text-meta text-muted-foreground">各家的差异点</h4>
              <ul className="mt-1.5 space-y-1">
                {variance.map((v) => (
                  <li key={v} className="text-body">
                    · {v}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-meta text-muted-foreground">
                合成一个画像会抹掉这些，但面试会针对性追问，所以单独留着。
              </p>
            </div>
          )}

          {/* JD 原文逐份列。聚合的是画像，原文一份都没动 */}
          <div>
            <h4 className="text-meta text-muted-foreground">
              JD 原文 · {jds.length} 份
            </h4>
            <div className="mt-1.5 space-y-1.5">
              {jds.map((jd, i) => (
                <div key={jd.id} className="rounded-md border border-border bg-surface-2">
                  <button
                    type="button"
                    onClick={() => setOpenJd(openJd === jd.id ? null : jd.id)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-meta text-foreground">
                      {jd.company || "未标公司"}
                    </span>
                    {jd.title && (
                      <span className="text-meta text-muted-foreground">{jd.title}</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {jd.rawJd.length} 字 {openJd === jd.id ? "▴" : "▾"}
                    </span>
                  </button>
                  {openJd === jd.id && (
                    <p className="whitespace-pre-wrap border-t border-border px-3.5 py-3 text-body">
                      {jd.rawJd}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
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
