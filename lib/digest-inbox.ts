import { readFile } from "node:fs/promises";
import { type LLMImage } from "@/lib/llm";
import { digestUnit, type SourceUnit, type UnitResult } from "@/lib/digest-unit";
import { auditUnit, type AuditFinding } from "@/lib/audit-digest";
import { linkAnswers } from "@/lib/link-answers";
import type { NewInsight, NewQuestion } from "@/lib/db/schema";

/**
 * 一条笔记最多读几张图。
 * 小红书面经常把干货切成多张长图，读不全就会漏掉后半截的题和答法——
 * 之前设 6 张，一条 9 图的笔记里"评测集怎么设计"那段整个丢了。
 */
const MAX_IMAGES = 14;



/** 出处校验挡掉了多少条。挡掉的都是指不出出处的，报出来才知道是模型没给还是被拦了 */
export interface DigestDropped {
  approachesReturned: number;
  approachesKept: number;
  insightsReturned: number;
  insightsKept: number;
}

export interface DigestResult {
  company: string;
  /** follows / answers 保留下标，落库时再翻译成 id */
  questions: (Omit<NewQuestion, "roleId"> & { follows: number | null })[];
  dropped: DigestDropped;
  /** 核对结果：漏抽 / 多抽。空数组表示这一轮没查出问题 */
  audit: AuditFinding[];
  /** 拆成了几个单元 */
  units: number;
  insights: (Omit<NewInsight, "inboxItemId"> & { answers: number | null })[];
}

/** 把图片下下来转 base64。失败的跳过，不要因为一张图挂掉整条 */
async function loadImages(urls: string[]): Promise<LLMImage[]> {
  const picked = urls.slice(0, MAX_IMAGES);
  const loaded: (LLMImage | null)[] = await Promise.all(
    picked.map(async (url): Promise<LLMImage | null> => {
      try {
        const res = await fetch(url, {
          headers: { Referer: "https://www.xiaohongshu.com/" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        // 太大的图先跳过，避免单条请求超限
        if (buf.byteLength > 4_500_000) return null;
        const mediaType = res.headers.get("content-type") ?? "image/webp";
        return { data: buf.toString("base64"), mediaType };
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((x): x is LLMImage => x !== null);
}

/** 视频帧存在本地，直接读文件 */
async function loadFrames(paths: string[]): Promise<LLMImage[]> {
  const loaded: (LLMImage | null)[] = await Promise.all(
    paths.slice(0, MAX_IMAGES).map(async (file): Promise<LLMImage | null> => {
      try {
        const buf = await readFile(file);
        return { data: buf.toString("base64"), mediaType: "image/jpeg" };
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((x): x is LLMImage => x !== null);
}

/** 每个单元一次调用，同时跑几个 */
const CONCURRENCY = 3;

/** 标题不一样但其实是同一道题：去掉标点空格再比 */
const normalize = (t: string) => t.replace(/[\s，。？?、,.:：；;""''「」]/g, "");

export async function digestInboxItem(item: {
  title: string | null;
  desc: string | null;
  author: string | null;
  images: string[];
  frames?: string[];
  isVideo?: boolean;
  transcript?: string | null;
}): Promise<DigestResult & { imagesRead: number }> {
  const images =
    item.frames && item.frames.length > 0
      ? await loadFrames(item.frames)
      : await loadImages(item.images);

  // 把素材拆成单元。一张图一个，正文一个，转写一个。
  // 每个单元单独发一次，任务边界清楚，模型不用在"抽全"和"抄准"之间取舍
  const units: SourceUnit[] = [];
  const descLines = (item.desc ?? "").split("\n").filter((l) => l.trim());
  if (descLines.length > 0) {
    units.push({ label: "正文", kind: "text", lines: descLines });
  }
  const transcriptLines = (item.transcript ?? "").split("\n").filter((l) => l.trim());
  if (transcriptLines.length > 0) {
    units.push({ label: "口播转写", kind: "text", lines: transcriptLines });
  }
  images.forEach((image, i) => {
    units.push({
      label: item.isVideo ? `视频截帧 ${i + 1}` : `图 ${i + 1}`,
      kind: "image",
      image,
    });
  });

  // 逐单元抽取
  const perUnit: { unit: SourceUnit; result: UnitResult }[] = [];
  for (let i = 0; i < units.length; i += CONCURRENCY) {
    const batch = units.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((u) => digestUnit(u, item.title)));
    batch.forEach((unit, k) => perUnit.push({ unit, result: results[k] }));
  }

  // 逐单元核对：漏抽 / 多抽
  const audit: AuditFinding[] = [];
  for (let i = 0; i < perUnit.length; i += CONCURRENCY) {
    const batch = perUnit.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ unit, result }) => auditUnit(unit, result, item.title))
    );
    for (const found of results) audit.push(...found);
  }

  const KINDS = ["behavioral", "technical", "case", "resume", "other"] as const;
  const IKINDS = ["approach", "company", "term", "pitfall"] as const;

  // 合并各单元。同一道题可能在好几张图里都出现，按归一化文本去重，
  // 保留带答法的那一条——有答法的信息更全
  type Merged = {
    text: string;
    kind: (typeof KINDS)[number];
    clusterId: string | null;
    followsKey: string | null;
    answer: { title: string; content: string; evidence: string } | null;
  };
  const byKey = new Map<string, Merged>();
  const order: string[] = [];

  let approachesReturned = 0;

  for (const { unit, result } of perUnit) {
    const keysInUnit = result.questions.map((q) => normalize(q.text ?? ""));
    result.questions.forEach((q, qi) => {
      const text = (q.text ?? "").trim();
      if (!text) return;
      const key = keysInUnit[qi];
      if (!key) return;

      const rawFollows =
        typeof q.follows === "number" && q.follows >= 0 && q.follows < qi
          ? keysInUnit[q.follows] || null
          : null;

      let answer: Merged["answer"] = null;
      if (q.answer) {
        approachesReturned++;
        const title = (q.answer.title ?? "").trim();
        const content = trimIncomplete((q.answer.content ?? "").trim());
        const quote = (q.answer.quote ?? "").trim();
        // 抄不出原话就是编的，丢掉
        if (title && content && quote) {
          answer = { title, content, evidence: `${unit.label}：${quote}` };
        }
      }

      const existing = byKey.get(key);
      if (!existing) {
        order.push(key);
        byKey.set(key, {
          text,
          kind: (KINDS.includes(q.kind as (typeof KINDS)[number])
            ? q.kind
            : "other") as (typeof KINDS)[number],
          clusterId: (q.cluster ?? "").trim() || null,
          followsKey: rawFollows,
          answer,
        });
      } else {
        // 已经有了：补上缺的部分，不覆盖已有的
        if (!existing.answer && answer) existing.answer = answer;
        if (!existing.followsKey && rawFollows) existing.followsKey = rawFollows;
        if (!existing.clusterId && q.cluster) existing.clusterId = q.cluster.trim();
      }
    });
  }

  const merged = order.map((k) => byKey.get(k)!);
  const indexOf = new Map(order.map((k, i) => [k, i] as const));

  const attached: DigestResult["insights"] = [];
  merged.forEach((m, i) => {
    if (!m.answer) return;
    attached.push({
      answers: i,
      kind: "approach",
      title: m.answer.title,
      content: m.answer.content,
      company: null,
      evidence: m.answer.evidence,
      evidenceKind: "text",
      tags: "[]",
    });
  });

  // 通用知识同样跨单元去重
  let insightsReturned = 0;
  const seenInsight = new Set<string>();
  const general: DigestResult["insights"] = [];
  for (const { unit, result } of perUnit) {
    for (const ins of result.insights) {
      insightsReturned++;
      const title = (ins.title ?? "").trim();
      const content = trimIncomplete((ins.content ?? "").trim());
      const quote = (ins.quote ?? "").trim();
      if (!title || !content || !quote) continue;
      const key = normalize(title);
      if (seenInsight.has(key)) continue;
      seenInsight.add(key);
      general.push({
        answers: null,
        kind: (IKINDS.includes(ins.kind as (typeof IKINDS)[number])
          ? ins.kind
          : "term") as (typeof IKINDS)[number],
        title,
        content,
        company: null,
        evidence: `${unit.label}：${quote}`,
        evidenceKind: "text",
        tags: "[]",
      });
    }
  }

  // 跨单元把答法挂回题上。题在图 5、答法在图 6 是常态，
  // 读图 6 那次调用看不见图 5 的题，只能先当通用知识吐出来
  const orphanApproaches = general
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.kind === "approach");

  if (orphanApproaches.length > 0 && merged.length > 0) {
    const links = await linkAnswers(
      merged.map((m) => m.text),
      orphanApproaches.map(({ g, i }) => ({
        index: i,
        title: g.title,
        content: g.content,
      }))
    );

    const takenBy = new Map<number, number>(attached.map((a) => [a.answers as number, 0]));
    const moved = new Set<number>();

    for (const { index, questionIndex } of links) {
      const g = general[index];
      if (!g || moved.has(index)) continue;

      const already = attached.find((a) => a.answers === questionIndex);
      if (already) {
        // 一道题只留一条：把内容并进去，别丢信息
        already.content = `${already.content}\n\n${g.content}`;
        already.evidence = `${already.evidence}\n${g.evidence}`;
      } else {
        attached.push({ ...g, answers: questionIndex });
        takenBy.set(questionIndex, 0);
      }
      moved.add(index);
    }

    // 挂上去的就不再重复出现在 playbook 里
    for (const i of [...moved].sort((a, b) => b - a)) general.splice(i, 1);
  }

  return {
    company: "",
    imagesRead: images.length,
    units: units.length,
    audit,
    dropped: {
      approachesReturned,
      approachesKept: attached.length,
      insightsReturned,
      insightsKept: general.length,
    },
    questions: merged.map((m) => ({
      text: m.text,
      kind: m.kind,
      clusterId: m.clusterId,
      rationale: "来自外部面经",
      source: "inbox" as const,
      follows:
        m.followsKey !== null ? (indexOf.get(m.followsKey) ?? null) : null,
    })),
    insights: [...attached, ...general],
  };
}

/**
 * 输出被 token 上限截断时，最后一句是半截的。
 * 留着半句话比截掉更糟——使用者会以为原文就写到那儿。
 */
function trimIncomplete(text: string): string {
  if (!text) return text;
  if (/[。！？!?.…」』）)】\]]$/.test(text)) return text;
  const cut = Math.max(
    text.lastIndexOf("。"),
    text.lastIndexOf("！"),
    text.lastIndexOf("？"),
    text.lastIndexOf("\n")
  );
  if (cut <= 0 || cut < text.length * 0.7) return text;
  return text.slice(0, cut + 1);
}
