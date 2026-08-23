import { DAILY_CALLS, DEMO } from "@/lib/demo";

/**
 * 演示站的说明条。
 * 访客需要立刻知道三件事：数据是假的、有额度、有些功能只有本地版才有。
 * 不说清楚，他们会以为是产品坏了。
 */
export function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="border-b border-border bg-lemon">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 sm:px-10">
        <span className="rounded-pill bg-lemon-ink/15 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-lemon-ink">
          Demo
        </span>
        <span className="text-meta text-lemon-ink">
          数据是虚构的，随便点。每天 {DAILY_CALLS} 点模型额度 ——
          出题、陪练、模拟面试都能真的跑。
        </span>
        <span className="text-meta text-lemon-ink/75">
          录音转写和实时提词需要本地的 whisper，演示站没装。
        </span>
      </div>
    </div>
  );
}
