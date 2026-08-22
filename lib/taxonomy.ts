/**
 * 面试题的两级分类。
 *
 * 一级是**固定集合**：不固定就会漂——之前主题完全由模型生成，
 * 结果「意图识别」和「AI产品与应用实践」并排成了同级，
 * 可前者其实是后者的子集。
 *
 * 但也不能死锁：素材是持续进来的，真出现框架外的东西时，
 * 模型可以新建一级分类（见 CANONICAL_L1 的提示词说明），
 * 代码这边只保证总数不超过 MAX_L1，超了就压一轮。
 */

export interface L1Def {
  name: string;
  /** 给模型看的判断依据 */
  hint: string;
  /** 二级分类的起手候选，模型可以不用，也可以另起 */
  seeds: string[];
}

export const CANONICAL_L1: L1Def[] = [
  {
    name: "Technical Foundations",
    hint: "考原理和实现：模型/Agent/检索怎么工作，怎么评测。不绑定具体业务场景。",
    seeds: [
      "Agent & Intent",
      "RAG & Retrieval",
      "Prompt Engineering",
      "Model Selection & Cost",
      "Evaluation & Badcase",
    ],
  },
  {
    name: "AI Application",
    hint: "考在具体业务里怎么设计 AI 产品。按业务域分二级，不按技术点分。",
    seeds: [
      "Shopping & Guide",
      "Search & Recommendation",
      "Content Generation",
      "Conversational Assistant",
      "Productivity Tools",
    ],
  },
  {
    name: "Business & Metrics",
    hint: "考业务判断和数据：指标怎么定、增长怎么做、怎么算账。",
    seeds: ["E-commerce Metrics", "Growth & Conversion", "Monetization", "Market & Competition"],
  },
  {
    name: "Experience & Behavior",
    hint: "考你本人：项目深挖、协作冲突、动机与规划。不考知识。",
    seeds: ["Project Deep-dive", "Collaboration & Conflict", "Motivation & Fit"],
  },
  {
    name: "Safety & Governance",
    hint: "考风险与合规：内容风控、隐私数据、模型合规。",
    seeds: ["Content Risk", "Privacy & Data", "Compliance"],
  },
];

/** 一级分类总数上限。5 个固定的 + 最多 2 个模型新建的 */
export const MAX_L1 = 7;

/** 每个一级下面二级分类的上限，超了压一轮 */
export const MAX_L2_PER_L1 = 6;

export const CANONICAL_L1_NAMES = CANONICAL_L1.map((d) => d.name);

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const CANONICAL_BY_NORM = new Map(
  CANONICAL_L1.map((d) => [normalize(d.name), d.name] as const)
);

/**
 * 把模型给的一级分类名归一。
 * 大小写、多余空格造成的「同一个分类算成两个」在这里拦掉；
 * 认不出来的原样保留——那就是模型新建的分类，是允许的。
 */
export function canonicalizeL1(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "Uncategorized";
  return CANONICAL_BY_NORM.get(normalize(trimmed)) ?? trimmed;
}

export function isCanonicalL1(name: string): boolean {
  return CANONICAL_BY_NORM.has(normalize(name));
}

/** 拼给模型看的一级分类说明 */
export function l1Block(): string {
  return CANONICAL_L1.map(
    (d) => `- ${d.name}：${d.hint}\n  二级候选：${d.seeds.join(" / ")}`
  ).join("\n");
}
