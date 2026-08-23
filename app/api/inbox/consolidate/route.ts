import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights, questions } from "@/lib/db/schema";
import {
  assignQuestionTaxonomy,
  consolidateInsights,
  findDuplicateQuestions,
  mergeTopics,
} from "@/lib/consolidate-insights";
import { isCanonicalL1, MAX_L1, MAX_L2_PER_L1 } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 把散落的知识条目去重 + 归主题，同时给面经题去重 */
export async function POST() {
  // 只整理通用知识。挂在题上的答法各自服务于不同的题，
  // 内容看着像但不能合并——合并了就把"这条答法对应哪道题"弄丢了
  const live = db
    .select()
    .from(insights)
    .where(and(isNull(insights.mergedInto), isNull(insights.questionId)))
    .all();

  const existingTopics = [
    ...new Set(live.map((i) => i.topic).filter((t): t is string => !!t)),
  ];

  let mergedCount = 0;
  let topicCount = 0;

  try {
    if (live.length > 0) {
      const assignments = await consolidateInsights(
        live.map((i) => ({
          id: i.id,
          kind: i.kind,
          title: i.title,
          content: i.content,
        })),
        existingTopics
      );

      for (const a of assignments) {
        db.update(insights)
          .set({ topic: a.topic, mergedInto: a.duplicateOf })
          .where(eq(insights.id, a.id))
          .run();
        if (a.duplicateOf) mergedCount++;
      }
      topicCount = new Set(assignments.map((a) => a.topic)).size;
    }

    // 面经题去重
    const inboxQs = db
      .select({ id: questions.id, text: questions.text })
      .from(questions)
      .where(
        and(
          eq(questions.source, "inbox"),
          isNull(questions.roleId),
          isNull(questions.mergedInto)
        )
      )
      .all();

    const dupes = await findDuplicateQuestions(inboxQs);
    for (const d of dupes) {
      // 标记而不删除：判错了还能捞回来
      db.update(questions)
        .set({ mergedInto: d.keep })
        .where(eq(questions.id, d.id))
        .run();
    }

    // 主题攒多了就压一轮，避免越消化越碎
    const afterAssign = [
      ...new Set(
        db
          .select({ topic: insights.topic })
          .from(insights)
          .where(and(isNull(insights.mergedInto), isNull(insights.questionId)))
          .all()
          .map((r) => r.topic)
          .filter((t): t is string => !!t)
      ),
    ];
    const cap = Math.max(4, Math.min(8, Math.ceil(live.length / 4)));
    const remap = await mergeTopics(afterAssign, cap);
    for (const [from, to] of remap) {
      db.update(insights).set({ topic: to }).where(eq(insights.topic, from)).run();
      db.update(questions).set({ topic: to }).where(eq(questions.topic, from)).run();
    }

    // 题分两级。只给主问题分：追问必须跟父级同组，
    // 否则渲染时会跟主问题拆散
    const allInbox = db
      .select({ id: questions.id, text: questions.text, parentId: questions.parentId })
      .from(questions)
      .where(and(eq(questions.source, "inbox"), isNull(questions.mergedInto)))
      .all();

    const merged = new Set(dupes.map((d) => d.id));
    const mains = allInbox.filter((q) => q.parentId === null && !merged.has(q.id));

    // 已经在用的二级分类喂回去，避免每批素材都起一套同义的新名
    const existingL2ByL1 = new Map<string, string[]>();
    for (const row of db
      .select({ l1: questions.topicL1, l2: questions.topic })
      .from(questions)
      .where(and(eq(questions.source, "inbox"), isNull(questions.mergedInto)))
      .all()) {
      if (!row.l1 || !row.l2) continue;
      const list = existingL2ByL1.get(row.l1) ?? [];
      if (!list.includes(row.l2)) list.push(row.l2);
      existingL2ByL1.set(row.l1, list);
    }

    const assigned = await assignQuestionTaxonomy(
      mains.map((q) => ({ id: q.id, text: q.text })),
      existingL2ByL1
    );

    for (const a of assigned) {
      db.update(questions)
        .set({ topicL1: a.l1, topic: a.l2, scope: a.scope })
        .where(eq(questions.id, a.id))
        .run();
    }

    // 一级分类攒多了就压一轮。固定的五个不参与合并，
    // 只压模型新建的那些——不然固定集合就白设了
    const liveL1 = [
      ...new Set(
        db
          .select({ l1: questions.topicL1 })
          .from(questions)
          .where(and(eq(questions.source, "inbox"), isNull(questions.mergedInto)))
          .all()
          .map((r) => r.l1)
          .filter((t): t is string => !!t)
      ),
    ];
    let l1Merged = 0;
    if (liveL1.length > MAX_L1) {
      const remapL1 = await mergeTopics(liveL1, MAX_L1);
      for (const [from, to] of remapL1) {
        if (isCanonicalL1(from) && from === to) continue;
        db.update(questions).set({ topicL1: to }).where(eq(questions.topicL1, from)).run();
        l1Merged++;
      }
    }

    // 每个一级下面的二级也压，超了才动
    let l2Merged = 0;
    for (const l1 of liveL1) {
      const l2s = [
        ...new Set(
          db
            .select({ l2: questions.topic })
            .from(questions)
            .where(
              and(
                eq(questions.source, "inbox"),
                eq(questions.topicL1, l1),
                isNull(questions.mergedInto)
              )
            )
            .all()
            .map((r) => r.l2)
            .filter((t): t is string => !!t)
        ),
      ];
      if (l2s.length <= MAX_L2_PER_L1) continue;
      const remapL2 = await mergeTopics(l2s, MAX_L2_PER_L1);
      for (const [from, to] of remapL2) {
        if (from === to) continue;
        db.update(questions)
          .set({ topic: to })
          .where(and(eq(questions.topicL1, l1), eq(questions.topic, from)))
          .run();
        l2Merged++;
      }
    }

    // 追问继承父级的两级分类。
    // 得沿着父链一路往上找，不能只看一层：
    // 追问底下还能挂追问（爷孙三级），只查 parent_id 为空的那批就漏了；
    // 而主问题这轮如果被判成重复合并掉，它自己没有分类，
    // 要跟着 merged_into 指向的那条留存的题走
    const chain = db
      .select({
        id: questions.id,
        parentId: questions.parentId,
        mergedInto: questions.mergedInto,
        l1: questions.topicL1,
        l2: questions.topic,
        scope: questions.scope,
      })
      .from(questions)
      .where(eq(questions.source, "inbox"))
      .all();
    const byId = new Map(chain.map((r) => [r.id, r] as const));

    const resolveTaxo = (
      startId: number
    ): { l1: string | null; l2: string | null; scope: "universal" | "domain" | null } | null => {
      let cursor: number | null = startId;
      const seen = new Set<number>();
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);
        const row: (typeof chain)[number] | undefined = byId.get(cursor);
        if (!row) return null;
        if (row.mergedInto !== null) {
          cursor = row.mergedInto;
          continue;
        }
        if (row.l1) return { l1: row.l1, l2: row.l2, scope: row.scope };
        cursor = row.parentId;
      }
      return null;
    };

    for (const q of allInbox) {
      if (q.parentId === null) continue;
      const inherited = resolveTaxo(q.parentId);
      if (!inherited?.l1) continue;
      db.update(questions)
        .set({ topicL1: inherited.l1, topic: inherited.l2, scope: inherited.scope })
        .where(eq(questions.id, q.id))
        .run();
      byId.set(q.id, {
        ...byId.get(q.id)!,
        l1: inherited.l1,
        l2: inherited.l2,
        scope: inherited.scope,
      });
    }

    // 挂在题上的答法跟着题走，playbook 里的按 kind 分组、不用主题
    for (const row of db
      .select({ id: insights.id, questionId: insights.questionId })
      .from(insights)
      .where(isNull(insights.mergedInto))
      .all()) {
      if (row.questionId === null) continue;
      const t = resolveTaxo(row.questionId);
      if (!t?.l1) continue;
      db.update(insights)
        .set({ topicL1: t.l1, topic: t.l2 })
        .where(eq(insights.id, row.id))
        .run();
    }

    const newL1 = assigned
      .filter((a) => a.newL1Reason && !isCanonicalL1(a.l1))
      .map((a) => ({ l1: a.l1, why: a.newL1Reason }));

    return NextResponse.json({
      insights: live.length,
      merged: mergedCount,
      topics: topicCount,
      topicsMerged: remap.size,
      questionsBefore: inboxQs.length,
      questionsMerged: dupes.length,
      l1Merged,
      l2Merged,
      // 模型自己开的新一级分类，报出来让人能看见框架外多了什么
      newL1: [...new Map(newL1.map((n) => [n.l1, n])).values()],
    });
  } catch (err) {
    return NextResponse.json(
      { error: `整理失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
