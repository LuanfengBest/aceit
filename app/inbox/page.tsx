import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = db
    .select()
    .from(inboxItems)
    .orderBy(desc(inboxItems.createdAt))
    .all();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Inbox ({items.length})</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">标题</th>
            <th className="p-2">作者</th>
            <th className="p-2">类型</th>
            <th className="p-2">状态</th>
            <th className="p-2">发布时间</th>
            <th className="p-2">入库时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="p-2">
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {item.title || "(无标题)"}
                  </a>
                ) : (
                  item.title || "(无标题)"
                )}
              </td>
              <td className="p-2">{item.author || "-"}</td>
              <td className="p-2">{item.type}</td>
              <td className="p-2">{item.status}</td>
              <td className="p-2">{item.publishedAt || "-"}</td>
              <td className="p-2">
                {item.createdAt ? item.createdAt.toLocaleString() : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="text-muted-foreground mt-4">暂无数据</p>
      )}
    </main>
  );
}
