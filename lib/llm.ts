import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import { generateObject, generateText, jsonSchema, type ModelMessage } from "ai";

/**
 * 模型调用的唯一入口。业务代码只认 task，不认模型名，也不直接引用 provider SDK。
 */

export type LLMTask =
  | "extract" // 从文本里抽结构化信息
  | "classify" // 分类 / 相似问题归类
  | "extract_image" // 从图片里抽信息（小红书图文笔记）
  | "refine" // 打磨答案
  | "generate"; // 生成新内容

/** 任务 → 模型。想换模型改这里就行，业务代码不用动。 */
export const TASK_MODEL: Record<LLMTask, string> = {
  extract: "claude-haiku-4-5",
  classify: "claude-haiku-4-5",
  // 下面三项本来是 claude-sonnet-5。先全切 Haiku 跑通流程省钱，
  // 等真正要拿答案去面试了，把 generate 和 refine 改回 sonnet-5——
  // 那两步的输出质量才是直接影响面试表现的。
  extract_image: "claude-haiku-4-5",
  refine: "claude-haiku-4-5",
  generate: "claude-haiku-4-5",
};

/** 各任务的默认输出上限，可被 options.maxOutputTokens 覆盖。 */
export const TASK_MAX_OUTPUT_TOKENS: Record<LLMTask, number> = {
  extract: 4000,
  classify: 1000,
  extract_image: 4000,
  refine: 8000,
  generate: 8000,
};

export interface LLMImage {
  /** base64 字符串，带不带 `data:image/...;base64,` 前缀都行 */
  data: string;
  /** 默认 image/jpeg；如果 data 是 data URL，会自动从里面读 */
  mediaType?: string;
}

export interface LLMOptions {
  system?: string;
  images?: LLMImage[];
  maxOutputTokens?: number;
  /** 临时指定模型，绕过 TASK_MODEL 映射 */
  model?: string;
  abortSignal?: AbortSignal;
}

export interface LLMResult {
  text: string;
  task: LLMTask;
  model: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const DATA_URL = /^data:([^;,]+);base64,/;

let provider: AnthropicProvider | null = null;

function getProvider(): AnthropicProvider {
  if (!provider) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("缺少环境变量 ANTHROPIC_API_KEY（放在 .env.local）");
    }
    provider = createAnthropic({ apiKey });
  }
  return provider;
}

function toImagePart(image: LLMImage) {
  const match = DATA_URL.exec(image.data);
  // AI SDK v7 里图片走 file part，旧的 image part 已废弃
  return {
    type: "file" as const,
    data: match ? image.data.slice(match[0].length) : image.data,
    mediaType: image.mediaType ?? match?.[1] ?? "image/jpeg",
  };
}

/**
 * 调模型。图片放在文本前面 —— Anthropic 对「先图后问」的效果更好。
 */
export async function callLLM(
  task: LLMTask,
  prompt: string,
  options: LLMOptions = {}
): Promise<LLMResult> {
  const model = options.model ?? TASK_MODEL[task];
  const images = options.images ?? [];

  const content =
    images.length > 0
      ? [...images.map(toImagePart), { type: "text" as const, text: prompt }]
      : prompt;

  const messages: ModelMessage[] = [{ role: "user", content }];

  const result = await generateText({
    model: getProvider()(model),
    system: options.system,
    messages,
    maxOutputTokens: options.maxOutputTokens ?? TASK_MAX_OUTPUT_TOKENS[task],
    abortSignal: options.abortSignal,
  });

  return {
    text: result.text,
    task,
    model,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}


/**
 * 要结构化结果时用这个，不要用 callLLM 再自己解析 JSON。
 * provider 侧会约束输出格式，原文里的引号、换行都由它负责转义。
 */
export async function callLLMObject<T>(
  task: LLMTask,
  prompt: string,
  schema: Record<string, unknown>,
  options: LLMOptions = {}
): Promise<{ object: T } & Omit<LLMResult, "text">> {
  const model = options.model ?? TASK_MODEL[task];
  const images = options.images ?? [];

  const content =
    images.length > 0
      ? [...images.map(toImagePart), { type: "text" as const, text: prompt }]
      : prompt;

  const messages: ModelMessage[] = [{ role: "user", content }];

  const result = await generateObject({
    model: getProvider()(model),
    schema: jsonSchema<T>(schema),
    system: options.system,
    messages,
    maxOutputTokens: options.maxOutputTokens ?? TASK_MAX_OUTPUT_TOKENS[task],
    abortSignal: options.abortSignal,
  });

  return {
    object: result.object,
    task,
    model,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}
