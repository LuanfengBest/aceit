import { callLLMObject } from "@/lib/llm";
import type { NewRoleProfile } from "@/lib/db/schema";

const SYSTEM = `你从招聘 JD 里抽出结构化的岗位画像，供面试准备使用。

- title：岗位名称。JD 里没写清楚就根据内容概括，不要留空
- company：公司名。JD 里没有就返回空字符串
- responsibilities：核心职责，3-6 条。用动词开头的短句，不要照抄整段
- requirements：硬性要求，3-8 条。学历、年限、必须会的技能、必须有的经验
- nice_to_have：加分项，0-5 条。写"优先""加分""了解…者优先"的那些
- keywords：能力关键词，5-10 个。用于和候选人的经历标签做匹配，所以要用通用说法，如 "数据分析" "A/B实验" "跨部门协作" "用户增长"，不要写成一整句话

只提取 JD 里实际写了的内容，不要替它补充行业常识。`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    company: { type: "string" },
    responsibilities: { type: "array", items: { type: "string" } },
    requirements: { type: "array", items: { type: "string" } },
    nice_to_have: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "company",
    "responsibilities",
    "requirements",
    "nice_to_have",
    "keywords",
  ],
  additionalProperties: false,
} as const;

interface RoleResult {
  title: string;
  company: string;
  responsibilities: string[];
  requirements: string[];
  nice_to_have: string[];
  keywords: string[];
}

const clean = (list: unknown): string[] =>
  Array.isArray(list)
    ? list
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

export async function extractRole(rawJd: string): Promise<Omit<NewRoleProfile, "rawJd">> {
  const { object } = await callLLMObject<RoleResult>(
    "extract",
    `JD 原文：\n\n${rawJd}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 4000 }
  );

  const title = (object.title ?? "").trim();
  const company = (object.company ?? "").trim();

  return {
    title: title || "未命名岗位",
    company: company || null,
    responsibilities: JSON.stringify(clean(object.responsibilities)),
    requirements: JSON.stringify(clean(object.requirements)),
    niceToHave: JSON.stringify(clean(object.nice_to_have)),
    keywords: JSON.stringify(clean(object.keywords)),
  };
}
