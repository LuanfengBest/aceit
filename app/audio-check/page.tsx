import { WorkShell } from "@/components/work-shell";
import { AudioCheck } from "@/components/audio/audio-check";

export const dynamic = "force-dynamic";

export default function AudioCheckPage() {
  return (
    <WorkShell
      meta="Setup"
      title="Audio check"
      subtitle="Before we build live coaching, confirm this machine can hear both sides of a browser-tab interview."
      image="/images/work-3.jpg"
      field="inbox"
    >
      <AudioCheck />

      <div className="mt-6 rounded-lg border border-border bg-surface-2 p-5 text-meta text-muted-foreground">
        <p className="font-mono uppercase tracking-[0.12em]">为什么要先测</p>
        <p className="mt-2 text-body">
          标签页音频采集在文档上可行，但有些会议网站会做音频保护。这一步跑通了，
          实时提词和面试录音才有基础；跑不通的话，得先装 BlackHole 把声音路由进来。
        </p>
      </div>
    </WorkShell>
  );
}
