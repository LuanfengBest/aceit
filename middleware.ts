import { NextRequest, NextResponse } from "next/server";
import {
  DEMO,
  cost,
  isLocalOnly,
  readQuota,
  spend,
  visitorKey,
  DemoLimitError,
} from "@/lib/demo";

/**
 * 演示版的闸门。
 *
 * 放在 middleware 而不是各个路由里：调模型的路由有 17 个，
 * 逐个包一层既啰嗦又容易漏。middleware 看路径就能判断，
 * 而且在请求进业务代码之前就挡住了。
 *
 * 非演示模式（本地跑）完全不生效。
 */
export function middleware(req: NextRequest) {
  if (!DEMO) return NextResponse.next();

  const path = req.nextUrl.pathname;

  // 依赖本地 whisper / ffmpeg 的功能，演示版直接明说不可用，
  // 而不是让人点了之后干等到超时
  const localOnly = isLocalOnly(path);
  if (localOnly) {
    return NextResponse.json(
      {
        error: `${localOnly}需要本地的 whisper 和 ffmpeg，演示版没装。这部分在本地版里是完整可用的。`,
        demoDisabled: true,
      },
      { status: 501 }
    );
  }

  const weight = cost(path);
  if (weight === 0) return NextResponse.next();

  const key = visitorKey(req.headers);
  try {
    spend(key, weight);
  } catch (err) {
    if (err instanceof DemoLimitError) {
      return NextResponse.json({ error: err.message, demoLimit: true }, { status: 429 });
    }
    throw err;
  }

  const q = readQuota(key);
  const res = NextResponse.next();
  // 让前端能显示「今天还剩几次」，不用另开一个接口
  res.headers.set("x-demo-remaining", String(q.remaining));
  res.headers.set("x-demo-limit", String(q.limit));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
