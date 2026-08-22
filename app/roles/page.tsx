import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { roleProfiles, experiences } from "@/lib/db/schema";
import { JdInput } from "@/components/roles/jd-input";
import { RoleCard } from "@/components/roles/role-card";
import { WorkShell } from "@/components/work-shell";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const roles = db
    .select()
    .from(roleProfiles)
    .orderBy(desc(roleProfiles.createdAt), desc(roleProfiles.id))
    .all();

  // 把岗位关键词和素材里的标签对一下，看哪些要求还没有经历支撑
  const myTags = new Set<string>();
  for (const row of db.select({ tags: experiences.tags }).from(experiences).all()) {
    try {
      for (const tag of JSON.parse(row.tags) as string[]) myTags.add(tag);
    } catch {
      // 忽略坏数据
    }
  }

  return (
    <WorkShell
      meta="Layer 03"
      title="Target Roles"
      subtitle="Paste a JD. See what they're really asking for, and what you can't answer yet."
      image="/images/work-2.jpg"
      field="roles"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Paste a job description
        </p>
        <p className="font-mono text-meta text-muted-foreground">{roles.length} roles</p>
      </div>

      <JdInput />

      <div className="mt-6 space-y-3">
        {roles.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
            No roles yet. Paste a JD and find out where you stand.
          </p>
        ) : (
          roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              matchedKeywords={(JSON.parse(role.keywords) as string[]).filter((k) =>
                myTags.has(k)
              )}
            />
          ))
        )}
      </div>
    </WorkShell>
  );
}
