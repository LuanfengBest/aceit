import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, questions } from "@/lib/db/schema";

/**
 * 跨岗位复用已经定稿的答案。
 *
 * 「为什么想做 AI 产品经理」「讲一个你做过的项目」这类题，投哪个岗都会问。
 * 打磨好一次之后，换个岗位再遇到同一 cluster 的题，就不该从零开始——
 * 把上次的定稿调出来当起点，改改措辞就行。这是 scope=universal 的意义所在。
 *
 * domain 题不走这条路：领域换了，答案的立足点也换了，
 * 复用上一个领域的答案反而会答偏。
 */
export interface ReusableAnswer {
  answerId: number;
  content: string;
  version: number;
  /** 这份定稿原本是给哪道题写的 */
  fromQuestionId: number;
  fromQuestionText: string;
}

export function findReusableAnswer(target: {
  id: number;
  clusterId: string | null;
  scope: string | null;
}): ReusableAnswer | null {
  // 只有 universal 题跨岗位复用；没有 cluster 就没法判断是不是同一道题
  if (target.scope !== "universal" || !target.clusterId) return null;

  // 这道题自己已经有定稿了，就不用去别处找
  const own = db
    .select({ id: answers.id })
    .from(answers)
    .where(and(eq(answers.questionId, target.id), eq(answers.status, "keeper")))
    .get();
  if (own) return null;

  const sibling = db
    .select({
      answerId: answers.id,
      content: answers.content,
      version: answers.version,
      questionId: questions.id,
      questionText: questions.text,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(
      and(
        eq(answers.status, "keeper"),
        eq(questions.clusterId, target.clusterId),
        ne(questions.id, target.id),
        isNull(questions.mergedInto)
      )
    )
    .orderBy(desc(answers.version))
    .get();

  if (!sibling) return null;
  return {
    answerId: sibling.answerId,
    content: sibling.content,
    version: sibling.version,
    fromQuestionId: sibling.questionId,
    fromQuestionText: sibling.questionText,
  };
}
