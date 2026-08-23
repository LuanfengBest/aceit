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
- **approach：这道题的答法，直接写在这道题里面。**
  素材里写了这道题怎么答、什么结构拿到了好评、面试官在追问什么方向，就填；
  **素材里没写就填 null。**

  **一道题只有一条 approach。**如果素材里这道题的答法是
  「背景 X → 目标 Y → 行动 Z → 成果 W」，那就把四段都写进同一个 content 里，
  写成一段能直接讲出来的话。不要拆成四条——拆开之后使用者看到的是碎片，
  拼不回一个完整答案。

  下面这些都算「素材里写了怎么答」，别漏：
  - 第一人称的参考回答（「我会先看…」「如果遇到这个情况，我不会认为…」）
  - 对这道题**在考什么**的分析（「考察候选人是否知道 CTR 提升不代表交易价值提升」
    「优秀候选人应该能拆解：曝光→点击→…」）——这类写的就是该怎么答，算答法
  - 答题框架、结构模板、踩雷提醒

  **素材里给了答法的题，一条都不能漏。**抽完自己核对一遍：
  每一道题，素材里如果写了怎么答，approach 是不是都填了。

  **但没写答法的题，approach 就是 null。**
  很常见的情况：一条笔记只是一份题目清单（Q1、Q2……Q26），从头到尾没有任何答案。
  这种就每道题的 approach 都填 null。
  **绝对不要用你自己的知识去回答那些题**——那不是"别人的答法"，是你编的。
  使用者会以为这是真实面经里的实战经验，据此去准备面试，那是误导。

二、参考知识（insights）——**每一条都必须指得出出处**

每条都要填 evidence，说明**这条内容本身**写在素材的哪个位置：
- 写在正文或口播转写里 → evidence_kind 填 "text"，
  evidence_start_line / evidence_end_line 填出处的起止行号（含两端）。
- 写在图片里 → evidence_kind 填 "image"，evidence_image 填第几张图（从 1 开始），
  并把图里的原话**照抄一句**到 evidence_quote，让人能拿去和图比对。

**注意：出处要指向内容本身所在的位置，不是它回答的那道题的位置。**
常见错误：正文里列着题号和题干、答法写在图里，你却把 evidence 指到正文的题干那一行。
这种情况 evidence_kind 应该填 "image"——答法在图里，不在正文里。

**指不出出处的，不要输出这一条。** 程序会按你给的行号把原文截出来存档，
指错了会被看出来。宁可少，不要编。

insights 这个数组只放**挂不到任何一道题上的通用知识**：
- company：这家公司/这个岗位的具体情况。面试流程几轮、考什么、什么风格、什么标准。
- term：行业黑话、评价标准、岗位术语的含义。**素材里解释了的才写。**
  你自己知道含义、但素材没解释的，不写。
- pitfall：踩坑记录。什么答法翻车了、什么雷区不能碰。素材里说了的才写。
- approach：不针对某一道具体题的通用答题方法论。
  **针对某道题的答法不要放这里**，放到那道题的 approach 字段里去。

规则：
- 素材如果只是泛泛的鸡汤、广告、引流，两类都返回空数组，不要硬凑。
- company 字段：能看出是哪家公司就填，看不出填空字符串。`;

const EVIDENCE_PROPS = {
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
} as const;

const EVIDENCE_REQUIRED = [
  "evidence_kind",
  "evidence_start_line",
  "evidence_end_line",
  "evidence_image",
  "evidence_quote",
] as const;

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
          // 答法直接嵌在题里，不再用下标互相指。
          // 之前 insights 用 answers 下标指回 questions，模型数错一位就答非所问，
          // 而且拦不住它给同一道题塞好几条——嵌进来这两件事都不可能发生了
          approach: {
            type: ["object", "null"],
            description:
              "素材里写了这道题怎么答，就填；没写就填 null。一道题只有一条。",
            properties: {
              title: { type: "string", description: "一句话概括这个答法" },
              content: {
                type: "string",
                description:
                  "完整答法。素材里如果是「背景→目标→行动→成果」，四段都写全，写成一段完整的话",
              },
              ...EVIDENCE_PROPS,
            },
            required: ["title", "content", ...EVIDENCE_REQUIRED],
            additionalProperties: false,
          },
        },
        required: ["text", "kind", "cluster", "follows", "approach"],
        additionalProperties: false,
      },
    },
    insights: {
      type: "array",
      description: "不挂在任何一道题上的通用知识。挂得上题的答法写进 questions[].approach",
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
          ...EVIDENCE_PROPS,
        },
        required: ["kind", "title", "content", "tags", ...EVIDENCE_REQUIRED],
        additionalProperties: false,
      },
    },
  },
  required: ["company", "questions", "insights"],
  additionalProperties: false,
} as const;

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

  type RawEvidence = {
    evidence_kind: string;
    evidence_start_line: number | null;
    evidence_end_line: number | null;
    evidence_image: number | null;
    evidence_quote: string | null;
  };

  const { object } = await callLLMObject<{
    company: string;
    questions: {
      text: string;
      kind: string;
      cluster: string;
      follows: number | null;
      approach: (RawEvidence & { title: string; content: string }) | null;
    }[];
    insights: (RawEvidence & {
      kind: string;
      title: string;
      content: string;
      tags: string[];
    })[];
  }>(
    // 有图走视觉任务，没图走普通抽取
    images.length > 0 ? "extract_image" : "extract",
    text,
    SCHEMA,
    // 答法现在嵌在题里，一次要吐的量比以前大得多。
    // 8000 时答法写到一半就断（"比如AI解决了" 就没了）；
    // 16000 时快手那条 14 道题只吐出 5 道——预算花在写答法上，题被挤掉了。
    // 少几道题比答法不全更糟，所以给足。
    { system: SYSTEM, images, maxOutputTokens: 32000 }
  );

  const KINDS = ["behavioral", "technical", "case", "resume", "other"] as const;
  const IKINDS = ["approach", "company", "term", "pitfall"] as const;
  const company = (object.company ?? "").trim();

  // follows 是**原始数组**的下标。下面要过滤掉空条目，
  // 过滤后下标会整体偏移，所以先记住原始位置再翻译。
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
    approach: q.approach ?? null,
  }));

  const kept = rawQuestions.filter((q) => q.text);
  const originalToKept = new Map<number, number>();
  kept.forEach((q, keptIndex) => originalToKept.set(q.originalIndex, keptIndex));

  const attached: DigestResult["insights"] = [];
  let approachesReturned = 0;
  kept.forEach((q, keptIndex) => {
    const a = q.approach;
    if (!a) return;
    approachesReturned++;
    const title = (a.title ?? "").trim();
    const content = trimIncomplete((a.content ?? "").trim());
    if (!title || !content) return;
    const evidence = sliceEvidence(a, sourceLines, images.length);
    if (!evidence) return;

    attached.push({
      answers: keptIndex,
      kind: "approach",
      title,
      content,
      company: company || null,
      evidence: evidence.text,
      evidenceKind: evidence.kind,
      tags: "[]",
    });
  });

  const general = (object.insights ?? [])
    .map((i) => {
      // 出处指不出来的直接丢掉。这是「digest 不编造」唯一靠得住的那道关——
      // 提示词只是要求，这里是执行。
      const evidence = sliceEvidence(i, sourceLines, images.length);
      if (!evidence) return null;

      return {
        answers: null,
        kind: (IKINDS.includes(i.kind as (typeof IKINDS)[number])
          ? i.kind
          : "approach") as (typeof IKINDS)[number],
        title: (i.title ?? "").trim(),
        content: trimIncomplete((i.content ?? "").trim()),
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
    .filter((i) => i.title && i.content);

  return {
    company,
    imagesRead: images.length,
    dropped: {
      approachesReturned,
      approachesKept: attached.length,
      insightsReturned: (object.insights ?? []).length,
      insightsKept: general.length,
    },
    questions: kept.map(({ originalIndex: _o, rawFollows, approach: _a, ...row }) => ({
      ...row,
      follows: rawFollows !== null ? (originalToKept.get(rawFollows) ?? null) : null,
    })),
    insights: [...attached, ...general],
  };
}

/**
 * 输出被 token 上限截断时，最后一句是半截的。
 * 留着半句话比截掉更糟——使用者会以为原文就写到那儿。
 * 只在明显没收尾时才动，正常结尾原样返回。
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
  // 砍掉超过三成就不砍了：那不是截断，是这条本来就没有句号
  if (cut <= 0 || cut < text.length * 0.7) return text;
  return text.slice(0, cut + 1);
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
