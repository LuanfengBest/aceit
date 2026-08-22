"use client";

import { useState } from "react";
import Link from "next/link";
import { DepthHero, HERO_SLIDES } from "@/components/home/depth-hero";

interface Step {
  eyebrow?: string;
  index?: string;
  title: string;
  body: string;
  /** 文字落在哪一侧，和图片错开 */
  side: "left" | "right";
}

const STEPS: Step[] = [
  {
    eyebrow: "All in one, personalized interview prep",
    title: "You did the work.\nCan you tell it?",
    body: "__ACEIT__ turns everything you've shipped into stories you can actually run — and rehearses them with you until they land.",
    side: "left",
  },
  {
    index: "01",
    title: "All in one, personalized",
    body: "Your résumé, your project docs, the role you're chasing, the mock rounds, the debriefs — one loop, one library. Aceit reads what you've actually done and writes the questions this role will actually ask you.",
    side: "right",
  },
  {
    index: "02",
    title: "It keeps absorbing",
    body: "Paste anything you come across — an interview debrief, a teardown of the team you're meeting, a story from someone who just sat where you're about to sit. Aceit pulls out the questions and the angles worth stealing, and files them next to your own material.",
    side: "left",
  },
  {
    index: "03",
    title: "The last mile — review",
    body: "Most people practice. Almost nobody reviews. Aceit runs the mock, then makes you sit with what happened: which answer wandered, which number you fumbled, which story you should have told instead.",
    side: "right",
  },
  {
    index: "04",
    title: "Four layers, one loop",
    body: "Material comes in. Roles align it. Stories get sharpened. Real interviews feed it back.",
    side: "left",
  },
];

const LAYERS = [
  { name: "Material", href: "/profile", live: true },
  { name: "Inbox", href: "/inbox", live: true },
  { name: "Roles", href: "/roles", live: true },
  { name: "Story Studio", href: null, live: false },
  { name: "Debrief", href: null, live: false },
] as const;

export function HeroCopy({
  stories,
  roles,
  pending,
  docs,
}: {
  stories: number;
  roles: number;
  pending: number;
  docs: number;
}) {
  const [progress, setProgress] = useState(0);

  const t = progress * (STEPS.length - 1);
  const index = Math.min(Math.round(t), HERO_SLIDES.length - 1);

  return (
    <div data-scroll-track className="relative" style={{ height: `${STEPS.length * 110}vh` }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <DepthHero onProgress={setProgress} />

        {/* 压一层，保证文字始终可读；两侧都压一点，因为文案会左右交替 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_50%,transparent_25%,rgba(18,14,11,0.55)_100%)]"
        />

        {STEPS.map((step, i) => {
          // 越靠近当前步骤越不透明，走过去就淡出
          const opacity = Math.max(0, Math.min(1, 1 - Math.abs(t - i) * 1.7));
          const shift = (t - i) * 40;
          const isLast = i === STEPS.length - 1;

          return (
            <div
              key={i}
              className="absolute inset-0 flex items-center"
              style={{
                opacity,
                pointerEvents: opacity > 0.6 ? "auto" : "none",
                transform: `translateY(${shift}px)`,
              }}
            >
              <div className="mx-auto w-full max-w-6xl px-6 sm:px-10">
                <div
                  className={
                    step.side === "right"
                      ? "ml-auto max-w-xl text-left"
                      : "mr-auto max-w-xl text-left"
                  }
                >
                  {step.eyebrow && (
                    <p className="on-dark-muted font-mono text-meta uppercase tracking-[0.14em]">
                      {step.eyebrow}
                    </p>
                  )}
                  {step.index && (
                    <p className="on-dark-muted font-serif text-title">{step.index}</p>
                  )}

                  <h2
                    className="on-dark mt-3 whitespace-pre-line font-serif leading-[1.05]"
                    style={{
                      fontSize: i === 0 ? "clamp(2.9rem, 7vw, 5.6rem)" : "clamp(1.9rem, 3.4vw, 3rem)",
                    }}
                  >
                    {step.title}
                  </h2>

                  <p
                    className="on-dark-muted mt-5"
                    style={{ fontSize: "clamp(0.95rem, 1.2vw, 1.1rem)" }}
                  >
                    {step.body.includes("__ACEIT__") ? (
                      <>
                        <span className="on-dark font-serif" style={{ fontSize: "1.4em" }}>
                          Aceit
                        </span>
                        {step.body.replace("__ACEIT__", "")}
                      </>
                    ) : (
                      step.body
                    )}
                  </p>

                  {/* 第一屏：主 CTA */}
                  {i === 0 && (
                    <div className="mt-9 flex flex-wrap gap-3">
                      <Link
                        href="/profile"
                        className="rounded-md bg-accent px-6 py-3 text-body text-accent-foreground transition-opacity hover:opacity-90"
                      >
                        Upload your résumé
                      </Link>
                      <Link
                        href="/roles"
                        className="on-dark rounded-md border border-white/35 px-6 py-3 text-body transition-colors hover:border-white/80"
                      >
                        Add a target role
                      </Link>
                    </div>
                  )}

                  {/* 最后一屏：跳到各个工作页 */}
                  {isLast && (
                    <ul className="mt-8 divide-y divide-white/15 border-y border-white/15">
                      {LAYERS.map((layer) => {
                        const row = (
                          <div className="flex items-center justify-between py-3">
                            <span className={layer.live ? "on-dark text-section" : "on-dark-muted text-section"}>
                              {layer.name}
                            </span>
                            <span className="on-dark-muted font-mono text-meta uppercase tracking-[0.1em]">
                              {layer.live ? "Open →" : "Coming"}
                            </span>
                          </div>
                        );
                        return (
                          <li key={layer.name}>
                            {layer.href ? (
                              <Link
                                href={layer.href}
                                className="block px-1 transition-colors hover:bg-white/10"
                              >
                                {row}
                              </Link>
                            ) : (
                              <div className="px-1">{row}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* 左下角序号 + 当前色点 */}
        <div className="pointer-events-none absolute bottom-9 left-6 sm:left-10">
          <p className="on-dark-muted font-mono text-meta">
            {String(index + 1).padStart(2, "0")} / {String(HERO_SLIDES.length).padStart(2, "0")}
          </p>
          <p className="on-dark mt-1 font-mono text-meta uppercase tracking-[0.12em]">
            {HERO_SLIDES[index].label}
          </p>
          <span
            className="mt-2 block h-2.5 w-2.5 rounded-full transition-colors duration-500"
            style={{
              backgroundColor: `#${HERO_SLIDES[index].color.toString(16).padStart(6, "0")}`,
            }}
          />
        </div>

        {/* 右下角实时数据 */}
        <div className="pointer-events-none absolute bottom-9 right-6 hidden font-mono text-meta sm:right-10 md:block">
          <Row label="STORIES" value={String(stories).padStart(3, "0")} />
          <Row label="FILES" value={String(docs).padStart(3, "0")} />
          <Row label="ROLES" value={String(roles).padStart(3, "0")} />
          <Row label="SIGNALS" value={String(pending).padStart(3, "0")} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-6">
      <span className="on-dark-muted w-20">{label}</span>
      <span className="on-dark">{value}</span>
    </p>
  );
}
