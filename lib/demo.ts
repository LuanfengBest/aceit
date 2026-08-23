/**
 * 演示模式。
 *
 * 上线一个能真的点、真的用的版本，但有两件事必须挡住：
 * 1. 花钱 —— 每个模型调用都是真金白银，一个链接放出去可能被跑爆
 * 2. 本地依赖 —— whisper 模型 1.4GB、CPU 转写很慢，托管环境上不划算
 *
 * 闸门放在 middleware：调模型的路由有 17 个，逐个包一层既啰嗦又容易漏，
 * 而 middleware 看路径就能判断，在请求进业务代码之前就挡住了。
 */

export const DEMO = process.env.DEMO_MODE === "1";

/** 每个访客每天的额度。一次「消化面经」算 10，一次「答题」算 2 */
export const DAILY_CALLS = Number(process.env.DEMO_DAILY_CALLS ?? 40);

/** 全站每天的总上限。防的是「很多人同时来」，不是单个人刷 */
export const GLOBAL_DAILY_CALLS = Number(process.env.DEMO_GLOBAL_DAILY_CALLS ?? 800);

export class DemoLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoLimitError";
  }
}

/**
 * 每条路径算几次额度。
 * 不是所有调用都一样贵——消化一条 9 图的面经要几十次模型调用，
 * 和答一道题记同样的账不合理。
 */
const COST: [RegExp, number][] = [
  [/^\/api\/inbox\/[^/]+\/digest/, 10],
  [/^\/api\/profile\/upload/, 8],
  [/^\/api\/questions\/generate/, 5],
  [/^\/api\/questions\/suggest/, 3],
  [/^\/api\/questions\/dedupe/, 5],
  [/^\/api\/questions\/link-experiences/, 5],
  [/^\/api\/inbox\/consolidate/, 8],
  [/^\/api\/roles/, 4],
  [/^\/api\/mock/, 1],
  [/^\/api\/practice/, 2],
  [/^\/api\/answers/, 2],
  [/^\/api\/interviews/, 3],
  [/^\/api\/live\/prompt/, 1],
];

/** 这条路径要花几次额度。0 表示不调模型，放行 */
export function cost(path: string): number {
  for (const [re, n] of COST) if (re.test(path)) return n;
  return 0;
}

/** 需要本地二进制的路径。返回功能名，不是这类就返回 null */
const LOCAL_ONLY: [RegExp, string][] = [
  [/^\/api\/live\/transcribe/, "实时转写"],
  [/^\/api\/recordings\/[^/]+\/transcribe/, "面试录音转写"],
  [/^\/api\/recordings(\/|$)/, "面试录音"],
];

export function isLocalOnly(path: string): string | null {
  for (const [re, what] of LOCAL_ONLY) if (re.test(path)) return what;
  return null;
}

/**
 * 计数存在内存里。
 * 单实例部署够用，重启会清零——demo 不值得为这个上一套持久化。
 */
type Bucket = { day: string; count: number };
const perVisitor = new Map<string, Bucket>();
let global: Bucket = { day: "", count: 0 };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 当前访客。用请求头里的 IP —— demo 不做登录，
 * 这个标识不精确（同一个 NAT 后面的人会共享额度），
 * 但足够挡住单个人反复刷。
 */
export function visitorKey(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "anonymous"
  );
}

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
  globalUsed: number;
  globalLimit: number;
}

export function readQuota(key: string): Quota {
  const d = today();
  const mine = perVisitor.get(key);
  const used = mine?.day === d ? mine.count : 0;
  const globalUsed = global.day === d ? global.count : 0;
  return {
    used,
    limit: DAILY_CALLS,
    remaining: Math.max(0, DAILY_CALLS - used),
    globalUsed,
    globalLimit: GLOBAL_DAILY_CALLS,
  };
}

/**
 * 记一次调用。超额抛 DemoLimitError，由路由转成人话返回。
 * 非演示模式下什么都不做。
 */
export function spend(key: string, weight = 1): void {
  if (!DEMO) return;
  const d = today();

  if (global.day !== d) global = { day: d, count: 0 };
  if (global.count + weight > GLOBAL_DAILY_CALLS) {
    throw new DemoLimitError(
      "今天这个演示站的总额度用完了。明天再来，或者把仓库 clone 到本地跑完整版。"
    );
  }

  const mine = perVisitor.get(key);
  const bucket = mine?.day === d ? mine : { day: d, count: 0 };
  if (bucket.count + weight > DAILY_CALLS) {
    throw new DemoLimitError(
      `演示版每人每天 ${DAILY_CALLS} 点模型额度，你今天用完了。明天会重置。`
    );
  }

  bucket.count += weight;
  perVisitor.set(key, bucket);
  global.count += weight;
}


