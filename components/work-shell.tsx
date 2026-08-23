import Image from "next/image";

/**
 * 每页的渐变直接从该页配图里提主色相做出来：
 * 同一色相三段递减饱和、递增明度，最后收进页面底色。
 */
const FIELDS = {
  material: { s1: "#E5D9BC", s2: "#F3ECD9", s3: "#FBF7EE", glow: "#E5D9BC" }, // 图片主色相 43°
  roles: { s1: "#E5D0BA", s2: "#F3E5D8", s3: "#FBF4ED", glow: "#E5D0BA" }, //     30°
  inbox: { s1: "#E5CAB1", s2: "#F3E2D2", s3: "#FBF2EA", glow: "#E5CAB1" }, //     29°
} as const;

export type FieldKey = keyof typeof FIELDS;

/**
 * 工作台页外壳：整页铺一层柔和色场，图片泡在色场里；
 * 内容区保持浅色实底，表格和卡片该怎么扫读还怎么扫读。
 */
export function WorkShell({
  title,
  subtitle,
  meta,
  image,
  field,
  below,
  layout = "split",
  children,
}: {
  title: string;
  subtitle: string;
  meta?: string;
  image: string;
  field: FieldKey;
  /** 放在左图右内容区域下方、占满整幅宽度的内容 */
  below?: React.ReactNode;
  /**
   * split —— 左边一列固定图片，右边内容。适合内容窄、以阅读为主的页
   * banner —— 图片压成顶部一条，内容全宽。
   *   Studio 这种左右两栏 + 队列 + 版本链的密集操作台，
   *   被 28% 的图片列挤掉之后每一栏都太窄了
   */
  layout?: "split" | "banner";
  children: React.ReactNode;
}) {
  const f = FIELDS[field];

  if (layout === "banner") {
    return (
      <div className="relative min-h-[calc(100vh-3.25rem)] overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `linear-gradient(180deg, ${f.s1} 0%, ${f.s2} 14%, ${f.s3} 28%, var(--bg) 46%)`,
          }}
        />

        <div className="mx-auto w-full max-w-[1500px] px-6 pt-6 sm:px-10">
          <div className="relative h-[9.5rem] overflow-hidden rounded-lg sm:h-[11rem]">
            <Image
              src={image}
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-[center_35%]"
              priority
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(100deg, rgba(24,20,16,0.86) 0%, rgba(24,20,16,0.55) 42%, rgba(24,20,16,0.12) 100%)",
              }}
            />
            <div className="absolute inset-y-0 left-0 flex max-w-[42rem] flex-col justify-center p-6 sm:p-8">
              <p className="font-mono text-meta uppercase tracking-[0.14em] text-white/65">
                {meta}
              </p>
              <h1 className="mt-1 font-serif text-title text-white">{title}</h1>
              <p className="mt-1.5 text-meta leading-relaxed text-white/75">{subtitle}</p>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1500px] px-6 py-8 sm:px-10">{children}</main>
        {below && (
          <div className="mx-auto w-full max-w-[1500px] px-6 pb-14 sm:px-10">{below}</div>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-3.25rem)] overflow-hidden">
      {/* 色场：三团马卡龙色晕开，越往下越淡，收进页面底色 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `linear-gradient(180deg, ${f.s1} 0%, ${f.s2} 22%, ${f.s3} 44%, var(--bg) 68%)`,
        }}
      />

      <div className="mx-auto flex w-full max-w-[1400px] gap-10 px-6 py-10 sm:px-10">
        <aside className="sticky top-[4.25rem] hidden h-[calc(100vh-8rem)] w-[28%] shrink-0 lg:block">
          <div className="relative h-full">
            {/* 图片背后的光晕，让它长在色场里而不是浮在上面 */}
            <div
              aria-hidden
              className="absolute -inset-6 -z-10 rounded-[2rem] blur-2xl"
              style={{ background: f.glow, opacity: 0.7 }}
            />
            <div className="relative h-full overflow-hidden rounded-lg">
              <Image src={image} alt="" fill sizes="28vw" className="object-cover" priority />
              {/* 底部渐隐收边，图片下缘融进色场 */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, transparent 38%, rgba(24,20,16,0.30) 62%, rgba(24,20,16,0.82) 100%)",
                }}
              />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <p className="font-mono text-meta uppercase tracking-[0.14em] text-white/65">
                  {meta}
                </p>
                <h1 className="mt-1 font-serif text-title text-white">{title}</h1>
                <p className="mt-1.5 text-meta leading-relaxed text-white/75">{subtitle}</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-6 lg:hidden">
            <p className="font-mono text-meta uppercase tracking-[0.14em] text-muted-foreground">
              {meta}
            </p>
            <h1 className="mt-1 font-serif text-title">{title}</h1>
            <p className="mt-1 text-meta text-muted-foreground">{subtitle}</p>
          </header>
          {children}
        </main>
      </div>

      {/* 全宽区：不受左侧图片列挤压，可读性优先 */}
      {below && (
        <div className="mx-auto w-full max-w-[1400px] px-6 pb-14 sm:px-10">{below}</div>
      )}
    </div>
  );
}
