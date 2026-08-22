import { HeroCopy } from "@/components/home/hero-copy";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, experiences, profileDocs, roleProfiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function Home() {
  const docs = db.select({ id: profileDocs.id }).from(profileDocs).all().length;
  const stories = db.select({ id: experiences.id }).from(experiences).all().length;
  const roles = db.select({ id: roleProfiles.id }).from(roleProfiles).all().length;
  const pending = db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(eq(inboxItems.status, "pending"))
    .all().length;

  return (
    <>
      <HeroCopy stories={stories} roles={roles} pending={pending} docs={docs} />

    </>
  );
}
