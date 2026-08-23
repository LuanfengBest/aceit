import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions, roleProfiles, experiences } from "@/lib/db/schema";
import { generateQuestions, type GenMode } from "@/lib/generate-questions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const list = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function POST(req: NextRequest) {
  let body: { roleId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  // 不给 roleId 就是出通用题库：跨岗位都会问的那些，不绑任何岗位
  const raw = Number(body.roleId);
  const roleId = Number.isInteger(raw) && raw > 0 ? raw : null;
  const mode: GenMode = roleId === null ? "universal" : "domain";

  const role = roleId === null
    ? null
    : db.select().from(roleProfiles).where(eq(roleProfiles.id, roleId)).get();
  if (roleId !== null && !role) {
    return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
  }

  const exps = db.select().from(experiences).all();
  if (exps.length === 0) {
    return NextResponse.json(
      { error: "经历库是空的，先去 Material 传一份简历" },
      { status: 400 }
    );
  }

  // 面经里这个方向真被问过的题，当出题的参照。
  // 给题本身比给素材原文有用——出题时要看的是「别人被问了什么」
  const wild = db
    .select({ text: questions.text })
    .from(questions)
    .where(
      and(
        eq(questions.source, "inbox"),
        isNull(questions.mergedInto),
        isNull(questions.parentId)
      )
    )
    .all()
    .map((q) => q.text);

  try {
    const generated = await generateQuestions({
      mode,
      role: !role ? null : {
        title: role.title,
        kind: role.kind,
        domain: role.domain,
        responsibilities: list(role.responsibilities),
        requirements: list(role.requirements),
        niceToHave: list(role.niceToHave),
        keywords: list(role.keywords),
        variance: list(role.variance),
      },
      experiences: exps.map((e) => ({
        title: e.title,
        summary: e.summary,
        detail: e.detail ?? "",
        tags: list(e.tags),
      })),
      wildQuestions: wild,
    });

    if (generated.length === 0) {
      return NextResponse.json({ error: "没有生成出问题" }, { status: 502 });
    }

    // 重新生成时清掉这个岗位上一批题（答案随之级联删除）
    // 只清掉这一轮该重出的那批：
    // 通用轮清「模型生成的通用题」（不碰 inbox 来的），岗位轮清这个岗位的
    if (roleId === null) {
      db.delete(questions)
        .where(
          and(
            isNull(questions.roleId),
            eq(questions.scope, "universal"),
            ne(questions.source, "inbox")
          )
        )
        .run();
    } else {
      db.delete(questions).where(eq(questions.roleId, roleId)).run();
    }

    // 先插主问题拿到 id，再回填追问的 parent_id——
    // follows 是数组下标，落库要翻译成真实 id
    const ids: number[] = [];
    for (const q of generated) {
      const { follows: _f, ...row } = q;
      // 通用题不绑岗位：投哪个岗都会问，绑上去就成了每个岗位各一份，
      // 打磨成果会散掉
      const r = db.insert(questions).values({ ...row, roleId }).run();
      ids.push(Number(r.lastInsertRowid));
    }
    let linked = 0;
    generated.forEach((q, i) => {
      if (q.follows === null || ids[q.follows] === undefined) return;
      db.update(questions)
        .set({ parentId: ids[q.follows] })
        .where(eq(questions.id, ids[i]))
        .run();
      linked++;
    });

    return NextResponse.json(
      {
        roleId,
        count: generated.length,
        mains: generated.length - linked,
        followUps: linked,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `出题失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
