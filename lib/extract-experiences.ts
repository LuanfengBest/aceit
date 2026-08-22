import { callLLMObject } from "@/lib/llm";
import { segmentDocument, type Segment } from "@/lib/segment-document";
import type { NewExperience } from "@/lib/db/schema";

export interface ExtractedExperience {
  title: string;
  summary: string;
  detail: string;
  tags: string[];
}

/** 模型只返回行号，原文由程序截取——避免模型复述原文时把引号写坏 */
interface LineRangeResult {
  title: string;
  summary: string;
  start_line: number;
  end_line: number;
  tags: string[];
}

const SYSTEM = `你从文档片段里识别并抽取「经历片段」——可以在面试里单独讲述的一件事。

输入的每一行都带行号前缀（如 "12| 正文"）。你不要复述原文，只要指出每条经历对应的**起止行号**，原文由程序自己去截取。

判断什么算经历：
- 算：一个具体项目、一次具体的分析或攻坚、一段有背景-动作-结果的叙事。
- 不算：目录、文件说明、维护规范、团队定位、组织架构、技能清单、课程列表、没有事件的教育背景、纯名词解释。这类直接跳过。
- 这段文本可能包含 0 条、1 条或多条经历。没有可抽的就返回空数组，不要硬凑。

判断粒度的标准：**这件事有没有自己的目标和产出物？**有 → 单独成条；没有、只是别人的实现手段 → 并进去。

必须拆开（有独立目标和产出的子产品 / 模块）：
- 一个大项目下面的主要模块，各自有自己的用户、指标、交付物，就是不同条。
- 例：一个 AI 情报引擎项目下面，「自动化报告生产」「知识库建设」「智能问答 Agent」「评测体系」是四条——它们各有各的准确率/覆盖率指标，面试时会分别讲。不要合并成一条"搭建了 AI 引擎"。
- 例：同一家公司下的「指标体系标准化」「用户分层产品」「渠道归因体系」是三条，目标和产出都不同。
- 简历里同一段任职下用项目符号列出、或以「XX设计：」「XX建设：」开头的并列条目，逐条拆开。

不要拆开（没有独立产出的实现手段）：
- 技术选型、排查过程、对接方式：如「跨团队Agent对接的契约层设计」「JSON中间表示的容错」「NaN值污染排查」
- 某个模块内部的做法：如「知识库追加策略」「配对质量拉齐验证」「评测集设计10篇29题」
- 这些并进它服务的那个模块里。

检验方法：面试官说"讲一个你做过的项目"，这条能不能撑起三到五分钟、有背景有动作有结果？能就单独成条，不能就是实现细节。

宁可细一点。一个大项目拆成 3-5 个模块是正常的，不是过度拆分。

字段：
- title：一句话标题，说清是什么事，不超过 25 字
- summary：2-3 句摘要，讲清背景、你做了什么、结果
- start_line / end_line：这条经历在原文里的起止行号（含两端）。范围要覆盖完整叙述，宁可多带上下文，不要只指一行
- tags：2-4 个能力标签，如 "项目管理" "数据分析" "跨部门协作" "实验设计"`;

const SCHEMA = {
  type: "object",
  properties: {
    experiences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "一句话标题，不超过 25 字" },
          summary: { type: "string", description: "2-3 句摘要" },
          start_line: { type: "integer", description: "起始行号（含）" },
          end_line: { type: "integer", description: "结束行号（含）" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "summary", "start_line", "end_line", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["experiences"],
  additionalProperties: false,
} as const;

/** 同时跑几段 */
const CONCURRENCY = 3;

async function extractSegment(segment: Segment): Promise<ExtractedExperience[]> {
  const lines = segment.text.split("\n");
  const numbered = lines.map((line, i) => `${i + 1}| ${line}`).join("\n");

  const header = segment.label ? `所属章节：${segment.label}\n\n` : "";
  const { object } = await callLLMObject<{ experiences: LineRangeResult[] }>(
    "extract",
    `${header}文档片段（共 ${lines.length} 行）：\n\n${numbered}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 8000 }
  );

  const out: ExtractedExperience[] = [];
  for (const item of object.experiences ?? []) {
    const start = Math.max(1, Math.floor(item.start_line));
    const end = Math.min(lines.length, Math.floor(item.end_line));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    // 原文在这里截取，模型碰不到它，引号和换行都原样保留
    const detail = lines
      .slice(start - 1, end)
      .join("\n")
      .replace(/^(?:\s*#{1,6}\s+.*\n+)+/, "") // 开头的标题行不算叙述内容
      .trim();
    if (!detail) continue;

    out.push({
      title: (item.title ?? "").trim(),
      summary: (item.summary ?? "").trim(),
      detail,
      tags: Array.isArray(item.tags) ? item.tags : [],
    });
  }
  return out;
}

/** 把整篇文档拆成经历片段。返回待插库的行，不含 docId */
export async function extractExperiences(
  rawText: string
): Promise<Omit<NewExperience, "docId">[]> {
  const segments = await segmentDocument(rawText);
  const collected: ExtractedExperience[] = [];

  for (let i = 0; i < segments.length; i += CONCURRENCY) {
    const batch = segments.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(extractSegment));
    for (const list of results) collected.push(...list);
  }

  // 跨段可能抽到同一条，标题相同时保留 detail 更长的那条
  const byTitle = new Map<string, ExtractedExperience>();
  for (const item of collected) {
    const title = (item.title ?? "").trim();
    const detail = (item.detail ?? "").trim();
    if (!title || !detail) continue;

    const key = title.replace(/\s+/g, "");
    const existing = byTitle.get(key);
    if (!existing || detail.length > existing.detail.length) {
      byTitle.set(key, { ...item, title, detail });
    }
  }

  return [...byTitle.values()].map((item) => ({
    title: item.title,
    summary: (item.summary ?? "").trim(),
    detail: item.detail,
    tags: JSON.stringify(
      (Array.isArray(item.tags) ? item.tags : [])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  }));
}
