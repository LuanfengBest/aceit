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

**digest 只做提取和整合，不做补充。**
产出的每一条都必须能在素材里找到出处——不多不少，只是把散落的信息整理成结构。
你自己知道的通用面试知识、通用方法论，一个字都不要写进来。

**重要：干货经常整个写在图片里**，正文可能只有一句话。图片一定要仔细读。
**每一张图都要读完**，面经常把内容切成多张长图，后面几张里往往还有题和答法。

正文和口播转写的每一行都带行号前缀（如 "12| 正文"），你要用行号指出出处。

产出两类东西：

一、面试题（questions）
- 素材里提到的**被问过的具体问题**，逐条抽出来，保留原本的问法。
- 只要真实被问过的题，不要自己编，也不要把"我觉得可以准备一下xx"当成题。
- kind 分类：behavioral / technical / case / resume / other
- cluster 用英文小写下划线给同类问题起个名，如 agent_intent_recognition
- **追问要挂到主问题上**：面经里常见"讲讲这个项目"→"你具体做了什么"→"指标是什么"
  这样的链条。后面那些是追问，把 follows 填成主问题在你输出数组里的下标（从 0 开始）。
  本身就是主问题的填 null。追问的 text 里不要再写"（追问）"前缀，层级已经体现了。

二、参考知识（insights）——**每一条都必须指得出出处**

每条都要填 evidence，说明**这条内容本身**写在素材的哪个位置：
- 写在正文或口播转写里 → evidence_kind 填 "text"，
  evidence_start_line / evidence_end_line 填出处的起止行号（含两端）。
- 写在图片里 → evidence_kind 填 "image"，evidence_image 填第几张图（从 1 开始），
  并把图里的原话**照抄一句**到 evidence_quote，让人能拿去和图比对。

**注意：出处要指向答法本身所在的位置，不是它回答的那道题的位置。**
常见错误：正文里列着题号和题干、答法写在图里，你却把 evidence 指到正文的题干那一行。
这种情况 evidence_kind 应该填 "image"——答法在图里，不在正文里。

**指不出出处的，不要输出这一条。** 程序会按你给的行号把原文截出来存档，
指错了会被看出来。宁可少，不要编。

- approach：**回答思路和结构**。素材里写了别人怎么答的、什么结构拿到了好评、
  面试官在追问什么方向，就抽出来。
  **素材里给了答法或答题框架的题，一条都不能漏。**抽完自己核对一遍：
  questions 里每一道题，素材里如果写了怎么答，是不是都有 approach 指向它。

  **但素材里没写答法的题，就不要给它配 approach。**
  很常见的情况：一条笔记只是一份题目清单（Q1、Q2……Q26），从头到尾没有任何答案。
  这种就 questions 照抽、insights 返回空数组。
  **绝对不要用你自己的知识去回答那些题**——那不是"别人的答法"，是你编的。
  使用者会以为这是真实面经里的实战经验，据此去准备面试，那是误导。

  - 用 answers 指明它回答的是 questions 里的哪一道题（下标）。
    实在对应不到具体某道题的通用方法论，才填 null。
  - **一道题最多给一条 approach。** 把完整答法写进这一条的 content 里：
    如果面经里这道题的答法是"背景 X → 目标 Y → 行动 Z → 成果 W"，
    那就是**一条** approach，content 里把四段都写全，
    **不要拆成"项目背景""项目目标""项目行动""项目成果"四条**——
    拆开之后使用者看到的是四个碎片，拼不回一个能讲出来的答案。
- company：这家公司/这个岗位的具体情况。面试流程几轮、考什么、什么风格、什么标准。
- term：行业黑话、评价标准、岗位术语的含义。**素材里解释了的才写。**
  你自己知道含义、但素材没解释的，不写。
- pitfall：踩坑记录。什么答法翻车了、什么雷区不能碰。素材里说了的才写。

规则：
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
          evidence_kind: {
            type: "string",
            enum: ["text", "image"],
            description: "出处在正文/转写里填 text，在图片里填 image",
          },
          evidence_start_line: {
            type: ["integer", "null"],
            description: "evidence_kind 为 text 时，出处的起始行号（含）",
          },
          evidence_end_line: {
            type: ["integer", "null"],
            description: "evidence_kind 为 text 时，出处的结束行号（含）",
          },
          evidence_image: {
            type: ["integer", "null"],
            description: "evidence_kind 为 image 时，第几张图（从 1 开始）",
          },
          evidence_quote: {
            type: ["string", "null"],
            description:
              "evidence_kind 为 image 时，从那张图里照抄一句原话，供人工比对；text 时填 null",
          },
        },
        required: [
          "kind", "title", "content", "tags", "answers",
          "evidence_kind", "evidence_start_line", "evidence_end_line",
          "evidence_image", "evidence_quote",
        ],
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

  // 素材逐行编号发给模型：它只回行号，出处原文由程序自己截。
  // 和拆经历用的是同一招——模型碰不到原文，就编不出出处。
  const sourceLines: string[] = [];
  if (item.title) sourceLines.push(`标题：${item.title}`);
  if (item.author) sourceLines.push(`作者：${item.author}`);
  if (item.desc) {
    sourceLines.push("正文：");
    sourceLines.push(...item.desc.split("\n"));
  }
  if (item.transcript) {
    sourceLines.push("");
    sourceLines.push("口播转写（这是视频里说的话，干货主要在这里）：");
    sourceLines.push(...item.transcript.split("\n"));
  }

  const numbered = sourceLines.map((line, i) => `${i + 1}| ${line}`).join("\n");
  const imageNote =
    images.length > 0
      ? item.isVideo
        ? `\n\n（另附 ${images.length} 张视频截帧，按顺序编号 1-${images.length}，字幕和画面里的文字要仔细读）`
        : `\n\n（另附 ${images.length} 张图，按顺序编号 1-${images.length}，干货可能主要在图里，仔细读）`
      : "";
  const text = numbered + imageNote;

  const { object } = await callLLMObject<{
    company: string;
    questions: { text: string; kind: string; cluster: string; follows: number | null }[];
    insights: {
      kind: string;
      title: string;
      content: string;
      tags: string[];
      answers: number | null;
      evidence_kind: string;
      evidence_start_line: number | null;
      evidence_end_line: number | null;
      evidence_image: number | null;
      evidence_quote: string | null;
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
      .map((i) => {
        // 出处指不出来的直接丢掉。这是"digest 不编造"唯一靠得住的那道关——
        // 提示词只是要求，这里是执行。
        const evidence = sliceEvidence(i, sourceLines, images.length);
        if (!evidence) return null;

        return {
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
          evidence: evidence.text,
          evidenceKind: evidence.kind,
          tags: JSON.stringify(
            (Array.isArray(i.tags) ? i.tags : [])
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim())
              .filter(Boolean)
          ),
        };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null)
      .filter((i) => i.title && i.content),
  };
}

/**
 * 把模型给的出处翻译成实际原文。
 * text 类按行号从素材里截，image 类只校验编号在范围内。
 * 两样都给不出来的返回 null，调用方丢弃这条 insight。
 */
function sliceEvidence(
  i: {
    evidence_kind: string;
    evidence_start_line: number | null;
    evidence_end_line: number | null;
    evidence_image: number | null;
    evidence_quote: string | null;
  },
  sourceLines: string[],
  imageCount: number
): { text: string; kind: "text" | "image" } | null {
  if (i.evidence_kind === "image") {
    const n = i.evidence_image;
    if (!Number.isInteger(n) || n === null || n < 1 || n > imageCount) return null;
    // 图里的内容程序验不了，所以要求模型抄一句原话回来，人能拿去和图对
    const quote = (i.evidence_quote ?? "").trim();
    if (!quote) return null;
    return { text: `图 ${n}：${quote}`, kind: "image" };
  }

  const rawStart = i.evidence_start_line;
  const rawEnd = i.evidence_end_line;
  if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd)) return null;

  const start = Math.max(1, Math.floor(rawStart as number));
  const end = Math.min(sourceLines.length, Math.floor(rawEnd as number));
  if (end < start) return null;

  const quote = sourceLines.slice(start - 1, end).join("\n").trim();
  if (!quote) return null;
  return { text: quote, kind: "text" };
}
