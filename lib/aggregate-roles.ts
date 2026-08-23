import { callLLMObject } from "@/lib/llm";

/**
 * 多份 JD 聚合成一个岗位画像。
 *
 * 之前一份 JD 一个画像，贴了四份 AI 产品经理的 JD 就出来四个同名 tab。
 * 重复不说，真正的损失是：四份 JD 里反复出现的那几条要求，
 * 才是这个岗位真正的考点——分开看就永远看不出哪条是共性、哪条是某一家的偏好。
 *
 * 聚合分两步：先判断新 JD 该并进哪个已有画像（还是自成一个），再重新提炼。
 */

export interface RoleShape {
  title: string;
  kind: "generalist" | "domain";
  domain: string | null;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  keywords: string[];
  /** 各家 JD 的差异点。聚合是有损的，这里把被抹掉的重要差异捞回来 */
  variance: string[];
}

/* ────────── 第一步：这份 JD 该并进哪儿 ────────── */

const ROUTE_SYSTEM = `判断一份新的 JD 应该并进哪个已有的岗位画像，还是自成一个。

判断依据是**面试时会不会问同一批问题**，不是标题像不像。

- 两份 JD 都是通用型 AI 产品经理（不绑定具体业务域），哪怕公司不同、
  标题一个叫「AI产品经理」一个叫「AI产品策划」，也该并成一个画像。
  它们的面试考点高度重合，分开准备是浪费。
- 一份绑定了具体业务域（搜索推荐、AI导购、内容生成、Agent平台……），
  就不要并进通用画像。领域知识是要单独准备的，混在一起会把重点冲淡。
- 两份绑定**同一个**业务域的，可以并。

kind：
- generalist —— JD 里说的是通用的 AI 产品能力（需求分析、模型能力理解、
  数据驱动、跨团队协作），没有绑死某个业务场景。
- domain —— JD 明确写了做什么业务：搜索、推荐、导购、内容生成、
  客服 Agent、办公提效……这类。

拿不准就新建，不要硬并。并错了比多一个画像更麻烦。`;

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    merge_into: {
      type: ["integer", "null"],
      description: "并进这个已有画像的 id；自成一个填 null",
    },
    kind: { type: "string", enum: ["generalist", "domain"] },
    domain: {
      type: ["string", "null"],
      description: "kind 为 domain 时填业务域，如「搜索推荐」「AI导购」；generalist 填 null",
    },
    title: { type: "string", description: "这份 JD 的岗位标题" },
    company: { type: "string", description: "公司名，看不出填空字符串" },
    reason: { type: "string", description: "为什么这么判断，一句话" },
  },
  required: ["merge_into", "kind", "domain", "title", "company", "reason"],
  additionalProperties: false,
} as const;

export interface RouteVerdict {
  mergeInto: number | null;
  kind: "generalist" | "domain";
  domain: string | null;
  title: string;
  company: string;
  reason: string;
}

export async function routeJd(
  rawJd: string,
  existing: { id: number; title: string; kind: string; domain: string | null }[]
): Promise<RouteVerdict> {
  const block = existing.length
    ? existing
        .map(
          (r) =>
            `[id=${r.id}] ${r.title}｜${r.kind === "domain" ? `业务域：${r.domain}` : "通用型"}`
        )
        .join("\n")
    : "（还没有任何画像）";

  const { object } = await callLLMObject<{
    merge_into: number | null;
    kind: string;
    domain: string | null;
    title: string;
    company: string;
    reason: string;
  }>(
    "classify",
    `## 已有的岗位画像\n${block}\n\n## 新贴的 JD\n${rawJd.slice(0, 6000)}`,
    ROUTE_SCHEMA,
    { system: ROUTE_SYSTEM, maxOutputTokens: 1500 }
  );

  const valid = new Set(existing.map((r) => r.id));
  const mergeInto =
    typeof object.merge_into === "number" && valid.has(object.merge_into)
      ? object.merge_into
      : null;

  return {
    mergeInto,
    kind: object.kind === "domain" ? "domain" : "generalist",
    domain: (object.domain ?? "")?.trim() || null,
    title: (object.title ?? "").trim() || "AI 产品经理",
    company: (object.company ?? "").trim(),
    reason: (object.reason ?? "").trim(),
  };
}

/* ────────── 第二步：把这一组 JD 重新提炼成一个画像 ────────── */

const SHAPE_SYSTEM = `把同一个岗位的多份 JD 提炼成一个画像。

这些 JD 来自不同公司，但面试时会问同一批问题。你要做的是**找出共性、留住差异**。

- responsibilities / requirements：**多份 JD 里反复出现的**放前面。
  只有一家提到的，除非很关键，否则不要往里塞——那会稀释真正的重点。
  每条写成一句话，具体，不要「负责相关产品工作」这种。
- keywords：贯穿多份 JD 的能力关键词，用来和候选人的经历标签做比对。
- variance：**被聚合抹掉但面试会问的差异点**。
  格式写成「某公司：具体差异」，比如「米哈游：强调游戏化场景和二次元用户理解」
  「腾讯：明确要求有 To C 亿级产品经验」。
  只有一家提、但可能被针对性追问的，都放这里。这是聚合的唯一损失，要补回来。

title：给这个画像起一个能代表全组的名字。
通用型就叫「AI 产品经理（通用）」这类；
绑业务域的把域写进去，如「AI 产品经理 · 搜索推荐」。`;

const SHAPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    responsibilities: { type: "array", items: { type: "string" } },
    requirements: { type: "array", items: { type: "string" } },
    nice_to_have: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    variance: {
      type: "array",
      items: { type: "string" },
      description: "「公司：差异点」，被聚合抹掉但面试会问的",
    },
  },
  required: ["title", "responsibilities", "requirements", "nice_to_have", "keywords", "variance"],
  additionalProperties: false,
} as const;

export async function shapeRole(
  jds: { company: string | null; title: string | null; rawJd: string }[],
  kind: "generalist" | "domain",
  domain: string | null
): Promise<Omit<RoleShape, "kind" | "domain">> {
  const block = jds
    .map(
      (j, i) =>
        `### JD ${i + 1}｜${j.company || "未标公司"}｜${j.title || ""}\n${j.rawJd.slice(0, 5000)}`
    )
    .join("\n\n");

  const head =
    kind === "domain"
      ? `这一组 JD 都绑定业务域：${domain}。\n\n`
      : "这一组 JD 都是通用型，没有绑定具体业务域。\n\n";

  const { object } = await callLLMObject<{
    title: string;
    responsibilities: string[];
    requirements: string[];
    nice_to_have: string[];
    keywords: string[];
    variance: string[];
  }>("extract", `${head}共 ${jds.length} 份 JD：\n\n${block}`, SHAPE_SCHEMA, {
    system: SHAPE_SYSTEM,
    maxOutputTokens: 6000,
  });

  const clean = (arr: unknown) =>
    (Array.isArray(arr) ? arr : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);

  return {
    title: (object.title ?? "").trim() || "AI 产品经理",
    responsibilities: clean(object.responsibilities),
    requirements: clean(object.requirements),
    niceToHave: clean(object.nice_to_have),
    keywords: clean(object.keywords),
    variance: clean(object.variance),
  };
}
