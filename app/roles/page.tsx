import { asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { roleProfiles, roleJds, experiences } from "@/lib/db/schema";
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

  // 每个画像底下挂的 JD 原文。聚合只合画像，原文一份不动——
  // 回头要核对某家具体怎么写的，还得看原文
  const allJds = db
    .select()
    .from(roleJds)
    .orderBy(asc(roleJds.id))
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
        <p className="font-mono text-meta text-muted-foreground">
          {roles.length} profiles · {allJds.length} JDs
        </p>
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
              jds={allJds
                .filter((j) => j.roleId === role.id)
                .map((j) => ({
                  id: j.id,
                  company: j.company,
                  title: j.title,
                  rawJd: j.rawJd,
                }))}
            />
          ))
        )}
      </div>
    </WorkShell>
  );
}
