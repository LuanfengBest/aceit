import { callLLMObject, type LLMImage } from "@/lib/llm";

/**
 * 一个「素材单元」：一张图、一段口播转写、或者笔记正文。
 *
 * 为什么要拆成单元：
 * 以前是把 12 张图 + 正文 + 转写一次性发出去，让模型吐一整个 JSON。
 * 抽题要的是广度（把每一道都找出来），写答法要的是深度（每条几百字），
 * 挤在一次调用里就会互相抢输出预算——压住了编造，题的召回就掉；
 * 放开了写答法，就开始编。
 *
 * 拆开之后每次只干一件小事：「这一个单元里有什么，照抄什么」。
 * 输出短、任务边界清楚，两边就不打架了。
 * 图片 token 是大头，12 张图分 12 次发和一次发总量差不多，成本没怎么涨。
 */
export interface SourceUnit {
  /** 展示用的名字，也是出处："图 3" / "口播转写" / "正文" */
  label: string;
  kind: "text" | "image";
  /** text 单元：按行拆好的正文 */
  lines?: string[];
  /** image 单元：这张图 */
  image?: LLMImage;
}

export interface UnitQuestion {
  text: string;
  kind: string;
  cluster: string;
  /** 同一单元里这是对第几道题的追问（下标），主问题填 null */
  follows: number | null;
  answer: { title: string; content: string; quote: string } | null;
}

export interface UnitInsight {
  kind: string;
  title: string;
  content: string;
  quote: string;
}

export interface UnitResult {
  questions: UnitQuestion[];
  insights: UnitInsight[];
}

const SYSTEM = `你在读一条面经素材里的**一个片段**（一张图、一段口播转写，或者笔记正文）。

你的工作只有一件事：**把这个片段里已经写着的东西照抄出来，整理成结构。**
不做归纳，不做补充，不做改写。你就是在复制粘贴 + 分类。

产出：

一、这个片段里出现的面试题（questions）
- 片段里出现的每一道题都要抽出来，**一道都不能漏**。保留原本的问法。
- 题目清单（Q1、Q2、Q3……）就是一道一道全抄下来。
- kind：behavioral / technical / case / resume / other
- cluster：英文小写下划线，给同类问题起个名，如 agent_intent_recognition
- follows：如果这道题是对本片段里前面某道题的追问，填那道题的下标（从 0 开始）；
  是主问题就填 null。

二、每道题的答法（写在 question 的 answer 字段里）
- 片段里写了这道题怎么答，就抄进来；**没写就填 null**。
- 算「写了怎么答」的有：
  · 第一人称的参考回答（「我会先看…」「如果遇到这个情况，我不会认为…」）
  · 对这道题**在考什么**的分析（「考察候选人是否知道 CTR 提升不代表交易价值提升」）
  · 答题框架、结构模板、踩雷提醒
- content 要完整。片段里如果写的是「背景→目标→行动→成果」，四段都抄进同一条里。
- quote：从片段里**照抄一句原话**，证明这个答法确实写在这儿。抄不出来就说明是你编的，
  那就把 answer 填 null。

**片段里只有题、没有答案，是很常见的情况。**那就每道题的 answer 都填 null。
**绝对不要用你自己的知识去回答那些题。**使用者会以为那是真实面经里的实战经验，
据此准备面试，那是误导。宁可 answer 全是 null，也不要编一个字。

三、不挂在任何一道题上的通用知识（insights）
- company：这家公司/这个岗位的情况，面试几轮、考什么、什么风格。
- term：行业黑话、评价标准、术语的含义。**片段里解释了的才写。**
- pitfall：踩坑记录。什么答法翻车了、什么雷区不能碰。
- approach：不针对某一道具体题的通用答题方法论。
- 同样每条都要 quote：从片段里照抄一句原话。

这个片段里什么都没有（纯封面图、纯引流文案、和面试无关），两个数组都返回空。
不要硬凑。`;

const SCHEMA = {
  type: "object",
  properties: {
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
          follows: { type: ["integer", "null"] },
          answer: {
            type: ["object", "null"],
            properties: {
              title: { type: "string", description: "一句话概括这个答法" },
              content: { type: "string", description: "完整答法，照抄片段里写的" },
              quote: { type: "string", description: "从片段里照抄的一句原话" },
            },
            required: ["title", "content", "quote"],
            additionalProperties: false,
          },
        },
        required: ["text", "kind", "cluster", "follows", "answer"],
        additionalProperties: false,
      },
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["approach", "company", "term", "pitfall"] },
          title: { type: "string" },
          content: { type: "string" },
          quote: { type: "string", description: "从片段里照抄的一句原话" },
        },
        required: ["kind", "title", "content", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions", "insights"],
  additionalProperties: false,
} as const;

/** 读一个单元。失败返回空，不要因为一张图挂掉整条素材 */
export async function digestUnit(
  unit: SourceUnit,
  noteTitle: string | null
): Promise<UnitResult> {
  const header = noteTitle ? `这条素材的标题：${noteTitle}\n\n` : "";
  const body =
    unit.kind === "text"
      ? `${header}片段（${unit.label}）：\n\n${(unit.lines ?? []).join("\n")}`
      : `${header}片段：${unit.label}（就是附的这张图，仔细读完，图里的文字全部读到）`;

  try {
    const { object } = await callLLMObject<UnitResult>(
      unit.kind === "image" ? "extract_image" : "extract",
      body,
      SCHEMA,
      {
        system: SYSTEM,
        images: unit.image ? [unit.image] : undefined,
        // 单元小，但答法可能写得长，给够
        maxOutputTokens: 12000,
      }
    );
    return {
      questions: Array.isArray(object.questions) ? object.questions : [],
      insights: Array.isArray(object.insights) ? object.insights : [],
    };
  } catch {
    return { questions: [], insights: [] };
  }
}
