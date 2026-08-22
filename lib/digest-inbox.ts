import { readFile } from "node:fs/promises";
import { callLLMObject, type LLMImage } from "@/lib/llm";
import type { NewInsight, NewQuestion } from "@/lib/db/schema";

/**
 * 一条笔记最多读几张图。
 * 小红书面经常把干货切成多张长图，读不全就会漏掉后半截的题和答法——
 * 之前设 6 张，一条 9 图的笔记里"评测集怎么设计"那段整个丢了。
 */
const MAX_IMAGES = 14;

const SYSTEM = `你在消化一条外部素材（多半是小红书的面经、行业分享、公司情报）。

**重要：干货经常整个写在图片里**，正文可能只有一句话。图片一定要仔细读，把里面的文字内容都提取出来。
**每一张图都要读完**，面经常把内容切成多张长图，后面几张里往往还有题和答法。

产出两类东西：

一、面试题（questions）
- 素材里提到的**被问过的具体问题**，逐条抽出来，保留原本的问法。
- 只要真实被问过的题，不要自己编，也不要把"我觉得可以准备一下xx"当成题。
- kind 分类：behavioral / technical / case / resume / other
- cluster 用英文小写下划线给同类问题起个名，如 agent_intent_recognition
- **追问要挂到主问题上**：面经里常见"讲讲这个项目"→"你具体做了什么"→"指标是什么"
  这样的链条。后面那些是追问，把 follows 填成主问题在你输出数组里的下标（从 0 开始）。
  本身就是主问题的填 null。追问的 text 里不要再写"（追问）"前缀，层级已经体现了。

二、参考知识（insights）
- approach：**回答思路和结构**。别人怎么答的、什么结构拿到了好评、面试官在追问什么方向。这是最有价值的一类，尽量抽全。
  **每条 approach 都要用 answers 指明它回答的是上面 questions 数组里的哪一道题（填下标）。**
  一条悬空的答法对使用者没用——他会看到一段"背景→目标→行动→成果"却不知道什么场景下该这么答。
  实在对应不到具体某道题的通用方法论，才填 null。

  **凡是素材里给了答法的题，都必须配一条 approach，一条都不能漏。**
  抽完之后自己核对一遍：questions 数组里每一道题，如果素材里写了怎么答，
  是不是都有对应的 approach 指向它？漏掉的补上。

  **一道题最多给一条 approach。** 把完整答法写进这一条的 content 里：
  如果面经里这道题的答法是"背景 X → 目标 Y → 行动 Z → 成果 W"，
  那就是**一条** approach，content 里把四段都写全，
  **不要拆成"项目背景""项目目标""项目行动""项目成果"四条**——
  拆开之后使用者看到的是四个碎片，拼不回一个能讲出来的答案。
- company：这家公司/这个岗位的具体情况。面试流程几轮、考什么、什么风格、什么标准。
- term：行业黑话、评价标准、岗位术语的具体含义。
- pitfall：踩坑记录。什么答法翻车了、什么雷区不能碰。

规则：
- 只提取素材里**真的写了**的内容，不要用你自己的通用面试知识补充。
- 素材如果只是泛泛的鸡汤、广告、引流，两类都返回空数组，不要硬凑。
- company 字段：能看出是哪家公司就填，看不出填空字符串。`;

const SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string", description: "这条素材主要讲哪家公司，看不出填空字符串" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: {
            type: "string",
            enum: ["behavioral", "technical", "case", "resume", "other"],
          },
          cluster: { type: "string" },
          follows: {
            type: ["integer", "null"],
            description: "这是对哪道题的追问，填那道题在本数组里的下标；主问题填 null",
          },
        },
        required: ["text", "kind", "cluster", "follows"],
        additionalProperties: false,
      },
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["approach", "company", "term", "pitfall"],
          },
          title: { type: "string", description: "一句话标题" },
          content: { type: "string", description: "具体内容，讲清楚可操作的部分" },
          tags: { type: "array", items: { type: "string" } },
          answers: {
            type: ["integer", "null"],
            description:
              "这条知识回答的是 questions 数组里的第几道题（下标）；通用的填 null",
          },
        },
        required: ["kind", "title", "content", "tags", "answers"],
        additionalProperties: false,
      },
    },
  },
  required: ["company", "questions", "insights"],
  additionalProperties: false,
} as const;

export interface DigestResult {
  company: string;
  /** follows / answers 保留下标，落库时再翻译成 id */
  questions: (Omit<NewQuestion, "roleId"> & { follows: number | null })[];
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

export async function digestInboxItem(item: {
  title: string | null;
  desc: string | null;
  author: string | null;
  images: string[];
  frames?: string[];
  isVideo?: boolean;
  transcript?: string | null;
}): Promise<DigestResult & { imagesRead: number }> {
  // 视频笔记优先用采集时抽的帧；图文笔记用原图
  const images =
    item.frames && item.frames.length > 0
      ? await loadFrames(item.frames)
      : await loadImages(item.images);

  const text = [
    item.title ? `标题：${item.title}` : "",
    item.author ? `作者：${item.author}` : "",
    item.desc ? `正文：${item.desc}` : "",
    item.transcript
      ? `\n口播转写（这是视频里说的话，干货主要在这里）：\n${item.transcript}`
      : "",
    images.length > 0
      ? item.isVideo
        ? `\n（另附 ${images.length} 张视频截帧，字幕和画面里的文字要仔细读）`
        : `\n（另附 ${images.length} 张图，干货可能主要在图里，仔细读）`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await callLLMObject<{
    company: string;
    questions: { text: string; kind: string; cluster: string; follows: number | null }[];
    insights: {
      kind: string;
      title: string;
      content: string;
      tags: string[];
      answers: number | null;
    }[];
  }>(
    // 有图走视觉任务，没图走普通抽取
    images.length > 0 ? "extract_image" : "extract",
    text,
    SCHEMA,
    { system: SYSTEM, images, maxOutputTokens: 8000 }
  );

  const KINDS = ["behavioral", "technical", "case", "resume", "other"] as const;
  const IKINDS = ["approach", "company", "term", "pitfall"] as const;
  const company = (object.company ?? "").trim();

  // 模型给的 follows / answers 是**原始数组**的下标。
  // 下面要过滤掉空条目，过滤后下标会整体偏移，
  // 所以先记住原始位置，再翻译成过滤后的位置——不然题和答法会错位一格。
  const rawQuestions = (object.questions ?? []).map((q, originalIndex) => ({
    originalIndex,
    text: (q.text ?? "").trim(),
    kind: (KINDS.includes(q.kind as (typeof KINDS)[number])
      ? q.kind
      : "other") as (typeof KINDS)[number],
    clusterId: (q.cluster ?? "").trim() || null,
    rationale: company ? `来自面经：${company}` : "来自外部面经",
    source: "inbox" as const,
    rawFollows:
      typeof q.follows === "number" && q.follows >= 0 && q.follows < originalIndex
        ? q.follows
        : null,
  }));

  const kept = rawQuestions.filter((q) => q.text);
  const originalToKept = new Map<number, number>();
  kept.forEach((q, keptIndex) => originalToKept.set(q.originalIndex, keptIndex));

  return {
    company,
    imagesRead: images.length,
    questions: kept.map(({ originalIndex: _o, rawFollows, ...row }) => ({
      ...row,
      follows: rawFollows !== null ? (originalToKept.get(rawFollows) ?? null) : null,
    })),
    insights: (object.insights ?? [])
      .map((i) => ({
        answers:
          typeof i.answers === "number" && i.answers >= 0
            ? (originalToKept.get(i.answers) ?? null)
            : null,
        kind: (IKINDS.includes(i.kind as (typeof IKINDS)[number])
          ? i.kind
          : "approach") as (typeof IKINDS)[number],
        title: (i.title ?? "").trim(),
        content: (i.content ?? "").trim(),
        company: company || null,
        tags: JSON.stringify(
          (Array.isArray(i.tags) ? i.tags : [])
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean)
        ),
      }))
      .filter((i) => i.title && i.content),
  };
}
