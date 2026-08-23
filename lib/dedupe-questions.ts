import { callLLMObject } from "@/lib/llm";

/**
 * 题库去重。
 *
 * 重复主要来自两个方向：面经里好几篇都记了「自我介绍」，
 * 模型出题时又出了一遍。三道「自我介绍」「请做一下自我介绍」「简单自我介绍」
 * 在队列里排成一列，练哪道都一样，纯占位置。
 *
 * 但判定必须保守。之前有一版去重把 22 道题砍到 11 道，
 * 把「如何衡量导购成功」和「话术怎么保证不违规」当成了同一道题——
 * 它们只是同一个项目的不同角度。所以：
 * - 只标记（merged_into），不删除。判错了能捞回来
 * - 标准是「答案能不能完全通用」，不是「话题像不像」
 * - 只处理主问题。追问天然贴着各自的主问题，跨主问题比没有意义
 * - **候选对由代码算相似度圈定，模型只能在候选里确认或否决**。
 *   第一版让模型自由配对，它把「怎么防止 Agent 上下文溢出」
 *   并进了「帮视频号创作者把文案效率提升30%」——两道毫不相干的题。
 *   提示词是要求，这道相似度门槛才是执行。
 */

const STOP = /[\s，。？?、,.:：；;""''「」（）()【】]/g;
const norm = (t: string) => t.replace(STOP, "");

/** 2-gram Jaccard。中文没有词边界，按字符二元组算最省事也够用 */
function similarity(a: string, b: string): number {
  const grams = (t: string) => {
    const s = norm(t);
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size < 2 || gb.size < 2) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;

  const jaccard = hit / (ga.size + gb.size - hit);
  // 长短差很多时 Jaccard 会被长度拖死：
  // 「自我介绍」和「请做一下自我介绍」只有 0.43，可它俩显然是一道题。
  // 再看一个包含度——短的那句是不是整个被长的那句盖住了
  const containment = hit / Math.min(ga.size, gb.size);
  return Math.max(jaccard, containment);
}

/**
 * 相似度门槛。0.55 是试出来的：
 * 「怎么防止Agent上下文溢出」vs「怎么防止 Agent 的上下文溢出」≈ 0.85（该合）
 * 「自我介绍」vs「请做一下自我介绍」≈ 0.6（该合）
 * 「怎么防止Agent上下文溢出」vs「视频号创作者文案效率提升30%」≈ 0.02（绝不能合）
 */
const MIN_SIMILARITY = 0.55;

export interface DupePair {
  /** 被并掉的 */
  id: number;
  /** 留下的 */
  keep: number;
}

export interface ClusterRename {
  from: string;
  to: string;
}

const SYSTEM = `给你一批**文本比较像的题目对**，逐对判断是不是真的重复。

判定标准只有一条：**同一份答案能不能同时答好这两道题？**
能 → 重复。不能 → 不是重复，哪怕话题一样。

算重复：
- 「自我介绍」「请做一下自我介绍」「简单介绍一下你自己」——同一道题的不同说法
- 「为什么想做 AI 产品经理」「为什么从运营转产品」——如果两道都在问转行动机
- 措辞、语气、长短不同，但问的是同一件事

**不算重复**（这里判错的代价最大，宁可放过）：
- 同一个项目的不同角度：「如何衡量导购成功」vs「话术怎么保证不违规」
- 同一个领域的不同技术点：「评测集怎么构建」vs「没有标准答案的题怎么打分」
- 一个问「是什么」，一个问「怎么做」
- 一个泛问，一个针对简历里的具体项目问——后者更有价值，两道都留

留哪一道：**问得更具体、更完整的那道**。
「请做一下自我介绍」比「自我介绍」好，因为它更像面试官真实的问法。

另外，给重复的那一组统一 cluster 名。
现在有的题标 introduction、有的标 self_introduction，指的是同一件事，
统一成一个（选更规范的那个），后面按 cluster 复用答案才对得上。

没有重复就返回空数组。别为了显得认真而硬找。`;

const SCHEMA = {
  type: "object",
  properties: {
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "被并掉的那道题的 id" },
          keep: { type: "integer", description: "留下的那道题的 id" },
          why: { type: "string", description: "为什么是同一道题，一句话" },
        },
        required: ["id", "keep", "why"],
        additionalProperties: false,
      },
    },
    cluster_renames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  required: ["duplicates", "cluster_renames"],
  additionalProperties: false,
} as const;

export async function dedupeQuestions(
  items: { id: number; text: string; cluster: string | null; hasAnswers: boolean }[]
): Promise<{ pairs: DupePair[]; renames: ClusterRename[] }> {
  if (items.length < 2) return { pairs: [], renames: [] };

  const byId = new Map(items.map((i) => [i.id, i] as const));

  // 代码先圈候选：只有文本足够像的两道题才拿去问模型。
  // 模型只能在这个名单里确认或否决，没法自由配对
  const candidates: { a: number; b: number; score: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const score = similarity(items[i].text, items[j].text);
      if (score >= MIN_SIMILARITY) {
        candidates.push({ a: items[i].id, b: items[j].id, score });
      }
    }
  }
  const allowed = new Set(candidates.map((c) => `${Math.min(c.a, c.b)}-${Math.max(c.a, c.b)}`));
  if (candidates.length === 0) return { pairs: [], renames: [] };

  const block = candidates
    .sort((x, y) => y.score - x.score)
    .slice(0, 60)
    .map(({ a, b, score }) => {
      const qa = byId.get(a)!;
      const qb = byId.get(b)!;
      return [
        `候选对（文本相似度 ${score.toFixed(2)}）`,
        `  [id=${a}]${qa.hasAnswers ? " ★已练过" : ""} ${qa.text}`,
        `  [id=${b}]${qb.hasAnswers ? " ★已练过" : ""} ${qb.text}`,
      ].join("\n");
    })
    .join("\n\n");

  const { object } = await callLLMObject<{
    duplicates: { id: number; keep: number; why: string }[];
    cluster_renames: { from: string; to: string }[];
  }>(
    "classify",
    `下面每一对都是文本比较像的题。**逐对判断是不是真的重复**，
是就填进 duplicates，不是就跳过。不要跨对配对。
★ 表示这道题已经有练习记录，同等条件下优先留它。\n\n${block}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 6000 }
  );

  const valid = new Set(items.map((i) => i.id));
  const seen = new Set<number>();
  const pairs: DupePair[] = [];

  for (const d of object.duplicates ?? []) {
    // 自己并自己、指向不存在的题、一道题被并两次——都跳过
    if (!valid.has(d.id) || !valid.has(d.keep) || d.id === d.keep) continue;
    if (seen.has(d.id)) continue;
    // 不在候选名单里的一律拒绝——模型只能在代码圈定的范围内做判断
    if (!allowed.has(`${Math.min(d.id, d.keep)}-${Math.max(d.id, d.keep)}`)) continue;
    // 留下的那道自己也被并掉了，会形成链，跳过这一条
    if ((object.duplicates ?? []).some((x) => x.id === d.keep)) continue;
    seen.add(d.id);
    pairs.push({ id: d.id, keep: d.keep });
  }

  const renames = (object.cluster_renames ?? [])
    .map((r) => ({ from: (r.from ?? "").trim(), to: (r.to ?? "").trim() }))
    .filter((r) => r.from && r.to && r.from !== r.to);

  return { pairs, renames };
}
