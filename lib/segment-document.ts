import { callLLMObject } from "@/lib/llm";

/** 小于这个长度的文档整篇送进去，不切 */
export const WHOLE_DOC_CHARS = 20000;

export interface Segment {
  /** 给模型看的上下文标签，如 "高德 Cipher · AI增长情报引擎" */
  label: string;
  text: string;
}

const SYSTEM = `你在给一份长文档划分「经历单元」的边界，供后续逐段抽取面试经历用。

输入是文档大纲：每行是 "行号| 内容"，可能是标题，也可能是段落的开头。

要求：
- 把文档划分成若干**独立单元**，每个单元大致对应一段可以分开讲的工作/项目经历。
- 有标题结构就顺着标题走；没有标题就根据内容判断话题在哪里换了。
- 单元要覆盖完整叙述，宁可多带一点上下文，不要把一段经历切断。
- 目录、文件说明、维护规范、团队定位、技能清单、纯名词解释这类没有叙事的部分，标记 skip=true。
- **单元大小要控制**：大纲每行末尾标了该段到下一段的字数。一个单元累计控制在 12000 字以内。
  某段经历特别长（比如一家公司下面写了五万字）就按它内部的小标题拆成多个单元，
  每个子模块（如「知识库建设」「问答Agent」）单独一个单元，不要把一整家公司塞成一个单元。
- label 用这个单元的标题或一句话概括，给后续步骤当上下文。`;

const SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
          skip: { type: "boolean", description: "非叙事内容，不用抽取" },
        },
        required: ["label", "start_line", "end_line", "skip"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
} as const;

/**
 * 生成大纲：标题行原样保留，普通段落只取开头一小段。
 * 目的是把几十万字压缩到几千 token，让模型能一眼看到全局结构。
 */
function buildOutline(lines: string[]): string {
  const picked: { index: number; text: string }[] = [];
  let inBlank = true;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      inBlank = true;
      return;
    }
    const isHeading = /^#{1,6}\s/.test(trimmed);
    // 标题全要；正文只取每个段落的第一行开头，避免大纲本身太长
    if (isHeading || inBlank) {
      picked.push({ index: i, text: trimmed.slice(0, 80) });
    }
    inBlank = false;
  });

  // 标出每个大纲条目到下一条之间有多少字，模型才知道哪一段特别厚
  return picked
    .map((row, n) => {
      const nextIndex = picked[n + 1]?.index ?? lines.length;
      const chars = lines
        .slice(row.index, nextIndex)
        .reduce((sum, l) => sum + l.length, 0);
      return `${row.index + 1}| ${row.text}   〔${chars}字〕`;
    })
    .join("\n");
}

/** 单元超过这个长度就强制再分——模型有时不肯拆细，代码兜底防止长上下文稀释 */
const MAX_SEGMENT_CHARS = 16000;

/** 把过大的单元按它内部的小标题再分；没有小标题就按段落分 */
function splitOversized(segment: Segment): Segment[] {
  if (segment.text.length <= MAX_SEGMENT_CHARS) return [segment];

  const lines = segment.text.split("\n");
  const headingLevels = lines
    .map((l) => /^(#{1,6})\s/.exec(l.trim())?.[1].length)
    .filter((n): n is number => n !== undefined);

  if (headingLevels.length > 1) {
    // 用文档里最细的那一层标题来切，切得动才有意义
    const level = Math.max(...headingLevels);
    const parts: { title: string; lines: string[] }[] = [];
    for (const line of lines) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (m && m[1].length === level) {
        parts.push({ title: m[2].trim(), lines: [line] });
      } else if (parts.length > 0) {
        parts[parts.length - 1].lines.push(line);
      } else {
        parts.push({ title: "", lines: [line] });
      }
    }

    // 相邻小段合并到接近上限，避免切得太碎
    const merged: Segment[] = [];
    for (const part of parts) {
      const text = part.lines.join("\n").trim();
      if (!text) continue;
      const last = merged[merged.length - 1];
      if (last && last.text.length + text.length <= MAX_SEGMENT_CHARS) {
        last.text = `${last.text}\n\n${text}`;
      } else {
        merged.push({
          label: part.title ? `${segment.label} › ${part.title}` : segment.label,
          text,
        });
      }
    }
    if (merged.length > 1) return merged;
  }

  return fallbackSplit(segment.text, MAX_SEGMENT_CHARS).map((s) => ({
    ...s,
    label: segment.label,
  }));
}

/** 兜底：模型划分失败时按段落硬切 */
function fallbackSplit(text: string, max = 14000): Segment[] {
  const out: Segment[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if (current.length + para.length + 2 > max && current) {
      out.push({ label: "", text: current });
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) out.push({ label: "", text: current });
  return out;
}

/**
 * 把文档划成待抽取的单元。
 * 短文档不切；长文档先让模型看大纲定边界，边界由模型判断而不是写死的字数。
 */
export async function segmentDocument(text: string): Promise<Segment[]> {
  if (text.length <= WHOLE_DOC_CHARS) {
    return [{ label: "", text }];
  }

  const lines = text.split("\n");

  try {
    const { object } = await callLLMObject<{
      sections: {
        label: string;
        start_line: number;
        end_line: number;
        skip: boolean;
      }[];
    }>(
      "classify",
      `文档共 ${lines.length} 行。大纲如下：\n\n${buildOutline(lines)}`,
      SCHEMA,
      { system: SYSTEM, maxOutputTokens: 8000 }
    );

    const segments: Segment[] = [];
    for (const s of object.sections ?? []) {
      if (s.skip) continue;
      const start = Math.max(1, Math.floor(s.start_line));
      const end = Math.min(lines.length, Math.floor(s.end_line));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

      const body = lines.slice(start - 1, end).join("\n").trim();
      if (body) segments.push({ label: (s.label ?? "").trim(), text: body });
    }

    if (segments.length > 0) return segments.flatMap(splitOversized);
  } catch {
    // 落到兜底
  }

  return fallbackSplit(text, MAX_SEGMENT_CHARS);
}
