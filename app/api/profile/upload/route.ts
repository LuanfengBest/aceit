import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileDocs, experiences } from "@/lib/db/schema";
import { parseDocument, UnsupportedFileError } from "@/lib/parse-doc";
import { extractExperiences } from "@/lib/extract-experiences";
import {
  judgeMerges,
  resolveCandidateRoot,
  type Candidate,
} from "@/lib/consolidate-experiences";

export const dynamic = "force-dynamic";
// 拆解长文档要跑一会儿
export const maxDuration = 600;

const DOC_TYPES = ["resume", "experience", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求不是 multipart 表单" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
  }
  const filename = file.name;

  const rawType = form.get("type");
  const type: DocType = DOC_TYPES.includes(rawType as DocType)
    ? (rawType as DocType)
    : "other";

  // 1. 解析成纯文本
  let rawText: string;
  try {
    rawText = await parseDocument(filename, await file.arrayBuffer());
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `解析失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  if (!rawText) {
    return NextResponse.json(
      { error: "文档解析出来是空的，可能是扫描版 PDF（图片没有文字层）" },
      { status: 400 }
    );
  }

  // 2. 先存原文。拆解失败也不能丢原文
  const inserted = db
    .insert(profileDocs)
    .values({ type, filename, rawText })
    .run();
  const docId = Number(inserted.lastInsertRowid);

  try {
    // 3. 拆片段
    const rows = await extractExperiences(rawText);
    const candidates: Candidate[] = rows.map((r) => ({
      title: r.title,
      summary: r.summary,
      detail: r.detail,
      tags: JSON.parse(r.tags ?? "[]") as string[],
    }));

    // 4. 和已有片段比对：同一件事合并，不新建
    const existing = db
      .select({
        id: experiences.id,
        title: experiences.title,
        summary: experiences.summary,
        detail: experiences.detail,
        tags: experiences.tags,
        sources: experiences.sources,
      })
      .from(experiences)
      .all();

    const verdicts = await judgeMerges(
      candidates,
      existing.map((e) => ({ id: e.id, title: e.title, summary: e.summary }))
    );

    // 候选内部先归并：同组原文拼在一起
    const groups = new Map<number, Candidate>();
    const mergeTargets = new Map<number, number>();

    candidates.forEach((candidate, i) => {
      const existingId = verdicts[i].mergeIntoExistingId;
      if (existingId !== null) {
        mergeTargets.set(i, existingId);
        return;
      }
      const root = resolveCandidateRoot(verdicts, i);
      const head = groups.get(root);
      if (!head) {
        groups.set(root, { ...candidate, tags: [...candidate.tags] });
      } else {
        head.detail = `${head.detail}\n\n${candidate.detail}`;
        head.tags = [...new Set([...head.tags, ...candidate.tags])];
      }
    });

    // 并进已有片段：追加原文和来源，不动标题摘要（可能被手动改过）
    let merged = 0;
    for (const [candidateIndex, targetId] of mergeTargets) {
      const target = existing.find((e) => e.id === targetId);
      if (!target) continue;
      const candidate = candidates[candidateIndex];

      const sources = new Set<string>([
        ...(JSON.parse(target.sources) as string[]),
        filename,
      ]);
      const tags = new Set<string>([
        ...(JSON.parse(target.tags) as string[]),
        ...candidate.tags,
      ]);

      db.update(experiences)
        .set({
          detail: `${target.detail}\n\n———— 来自 ${filename} ————\n\n${candidate.detail}`,
          tags: JSON.stringify([...tags]),
          sources: JSON.stringify([...sources]),
        })
        .where(eq(experiences.id, targetId))
        .run();
      merged++;
    }

    const fresh = [...groups.values()];
    if (fresh.length > 0) {
      db.insert(experiences)
        .values(
          fresh.map((c) => ({
            docId,
            title: c.title,
            summary: c.summary,
            detail: c.detail,
            tags: JSON.stringify(c.tags),
            sources: JSON.stringify([filename]),
          }))
        )
        .run();
    }

    return NextResponse.json(
      { docId, filename, chars: rawText.length, count: fresh.length, merged },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        docId,
        filename,
        chars: rawText.length,
        count: 0,
        error: `原文已存，但拆解失败：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }
}
