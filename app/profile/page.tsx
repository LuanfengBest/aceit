import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { experiences, profileDocs } from "@/lib/db/schema";
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
        }))}
        docs={docRows}
      />
    </WorkShell>
  );
}
