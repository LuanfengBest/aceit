import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { experiences, profileDocs, questions } from "@/lib/db/schema";
import { UploadPanel } from "@/components/profile/upload-panel";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { WorkShell } from "@/components/work-shell";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const fragmentRows = db
    .select({ experience: experiences, filename: profileDocs.filename })
    .from(experiences)
    .leftJoin(profileDocs, eq(experiences.docId, profileDocs.id))
    .orderBy(desc(experiences.createdAt), desc(experiences.id))
    .all();

  const allDocs = db
    .select()
    .from(profileDocs)
    .orderBy(desc(profileDocs.createdAt), desc(profileDocs.id))
    .all();

  // 每条经历被问过几道题。142 道题回填关联之后才算得出来——
  // 之前只能靠感觉，实际分布极不均：最多的 44 道，最少的 3 道
  const askedCount = new Map<number, number>();
  for (const row of db
    .select({ experienceIds: questions.experienceIds })
    .from(questions)
    .where(and(isNull(questions.mergedInto), isNull(questions.parentId)))
    .all()) {
    try {
      for (const id of JSON.parse(row.experienceIds || "[]") as number[]) {
        askedCount.set(id, (askedCount.get(id) ?? 0) + 1);
      }
    } catch {
      // 坏数据跳过
    }
  }
  const asked = [...askedCount.values()];
  const busiest = asked.length > 0 ? Math.max(...asked) : 0;

  const counts = new Map<number, number>();
  for (const row of fragmentRows) {
    const docId = row.experience.docId;
    counts.set(docId, (counts.get(docId) ?? 0) + 1);
  }

  const docRows = allDocs.map((doc) => ({
    doc,
    fragmentCount: counts.get(doc.id) ?? 0,
  }));

  return (
    <WorkShell
      meta="Layer 01"
      title="Your Material"
      subtitle="Everything you've actually done, broken into stories you can reach for."
      image="/images/work-1.jpg"
      field="material"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Upload
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {allDocs.length} files · {fragmentRows.length} stories
        </p>
      </div>

      <UploadPanel />

      <ProfileTabs
        fragments={fragmentRows.map((r) => ({
          experience: r.experience,
          filename: r.filename,
          asked: askedCount.get(r.experience.id) ?? 0,
        }))}
        busiest={busiest}
        docs={docRows}
      />
    </WorkShell>
  );
}
