/**
 * 造一份演示库。
 *
 * 演示站要能真的点，就得有数据；但不能是本人的——
 * 经历原文有具体数字和内部系统名，复盘里更是「哪几道题答砸了」。
 * 所以整套换成一个虚构的候选人，覆盖每一层，让人能走完整条链路。
 *
 *   npx tsx scripts/seed-demo.ts data/demo.db
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "data/demo.db";
rmSync(out, { force: true });
const db = new Database(out);
db.pragma("foreign_keys = ON");

// 用真实的迁移文件建表，保证 schema 和产品完全一致
const dir = path.join(process.cwd(), "drizzle");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(path.join(dir, f), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) {
      try {
        db.exec(s);
      } catch {
        // 迁移里有些是幂等的重复语句，跳过
      }
    }
  }
}

const now = Math.floor(Date.now() / 1000);

/* ── 01 个人素材 ── */
const doc = db
  .prepare(
    `insert into profile_docs (type, filename, raw_text, created_at) values (?,?,?,?)`
  )
  .run("resume", "demo-resume.md", "（演示数据）", now);

const EXPERIENCES: [string, string, string, string[]][] = [
  [
    "智能客服 Agent：意图分类到回答框架全链路",
    "从 0 到 1 搭建客服场景的问答 Agent，意图二分类 + 双路正交抽取驱动取数与回答。",
    "背景：客服人力随工单量线性增长，重复问题占比超过六成。\n\n做法：先做意图二分类（业务咨询 / 系统问题），再按意图走不同的抽取路径——业务咨询走知识库检索，系统问题走日志查询。两路正交，避免一个大 prompt 什么都想干。\n\n评测：10 篇源文档、29 道题，覆盖简单/中等/困难三档。有知识库 vs 全文基线做对照，准确率 +1.5pp、回答丰富度 +4.4pp。\n\n结果：平均响应 29.1 秒，意图准确率 98%，人工介入率下降四成。\n\n没做好的地方：知识库里两篇文档结论冲突时没有仲裁机制，只能取最新的一篇。",
    ["Agent设计", "意图识别", "评测体系", "RAG"],
  ],
  [
    "推荐链路 A/B 实验与因果推断评估",
    "用配对 T 检验评估推荐策略改版效果，拉齐 4 个协变量、14 对样本。",
    "背景：推荐策略改版后 CTR 涨了但 GMV 没动，需要判断是策略问题还是指标口径问题。\n\n做法：配对设计，按品类、日均单量、用户结构、季节性四个协变量拉齐，选出 14 对可比城市。\n\n结论：点估计达标，但 95% 置信区间上界没到 MDE——这是小样本设计的必然结果，不是策略无效。向管理层沟通时把「发现了效应」和「效应量不确定」分开说。\n\n后续：把这套配对流程固化成模板，后面三次改版直接复用。",
    ["因果推断", "实验设计", "数据分析"],
  ],
  [
    "冷启动场景下的供给侧调控",
    "周度监控-调参闭环，阶梯涨价档位调整，规模和体验双好、净额由负转正。",
    "背景：新城冷启动阶段供给不足，直接补贴成本高且退坡后掉得快。\n\n做法：把补贴改成阶梯式，按时段和区域分档。建周度监控-调参闭环，每周看一次履约率和净额，调一次档位。\n\n结果：规模和体验双好，净额由负转正。\n\n踩过的坑：一开始调参频率定成每天，效果评估根本收敛不了，噪声比信号大。改成周度才稳定。",
    ["增长策略", "指标体系", "运营机制"],
  ],
];

const expIds: number[] = [];
for (const [title, summary, detail, tags] of EXPERIENCES) {
  const r = db
    .prepare(
      `insert into experiences (doc_id, title, summary, detail, tags, sources, created_at)
       values (?,?,?,?,?,?,?)`
    )
    .run(
      doc.lastInsertRowid,
      title,
      summary,
      detail,
      JSON.stringify(tags),
      JSON.stringify(["demo-resume.md"]),
      now
    );
  expIds.push(Number(r.lastInsertRowid));
}

/* ── 03 岗位画像 ── */
const roleGeneral = db
  .prepare(
    `insert into role_profiles
     (title, company, raw_jd, responsibilities, requirements, nice_to_have, keywords, kind, domain, topics, variance, created_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  .run(
    "AI 产品经理（通用）",
    null,
    "（演示数据：三份通用型 AI 产品经理 JD 聚合）",
    JSON.stringify([
      "负责 AI 能力在业务场景的产品化落地",
      "定义需求、拆解链路、推动跨团队实现",
      "建立效果评估体系并持续迭代",
    ]),
    JSON.stringify([
      "理解大模型能力边界，能判断什么该用模型、什么不该",
      "能把模糊需求拆成可执行的产品方案",
      "数据驱动决策，看得懂实验结果",
      "跨团队沟通与推动能力",
    ]),
    JSON.stringify(["有 Agent / RAG 相关项目经验", "熟悉 Prompt 工程"]),
    JSON.stringify(["大模型应用", "需求定义", "数据驱动", "跨团队协作", "效果评估"]),
    "generalist",
    null,
    JSON.stringify([
      "Agent & Intent",
      "RAG & Retrieval",
      "Prompt Engineering",
      "Evaluation & Badcase",
      "Project Deep-dive",
      "Collaboration & Conflict",
    ]),
    JSON.stringify([
      "A 公司：强调游戏化场景和二次元用户理解，要参与 Prompt 模板设计与效果迭代",
      "B 公司：明确要求理解 LLM/MLLM、Agent 架构、RAG，看重 AI 产品独特体验指标（准确率、幻觉率、用户信任度）",
    ]),
    now
  );

const roleSearch = db
  .prepare(
    `insert into role_profiles
     (title, company, raw_jd, responsibilities, requirements, nice_to_have, keywords, kind, domain, topics, variance, created_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  .run(
    "AI 产品经理 · 搜索推荐",
    null,
    "（演示数据：一份搜索推荐方向的 JD）",
    JSON.stringify(["负责搜索场景的 query 理解与意图改写", "设计并迭代相关性评测体系"]),
    JSON.stringify(["熟悉召回-粗排-精排链路", "理解 embedding 与向量检索原理"]),
    JSON.stringify(["有相关性评测集设计经验"]),
    JSON.stringify(["query理解", "向量检索", "相关性评测", "召回排序"]),
    "domain",
    "搜索推荐",
    JSON.stringify(["Search & Recommendation", "RAG & Retrieval", "Evaluation & Badcase"]),
    JSON.stringify([]),
    now
  );

for (const [roleId, n] of [
  [roleGeneral.lastInsertRowid, 3],
  [roleSearch.lastInsertRowid, 1],
] as const) {
  for (let i = 0; i < n; i++) {
    db.prepare(
      `insert into role_jds (role_id, company, title, raw_jd, created_at) values (?,?,?,?,?)`
    ).run(roleId, `演示公司 ${String.fromCharCode(65 + i)}`, "AI 产品经理", "（演示数据：JD 原文）", now);
  }
}

/* ── 02 外部情报 ── */
const signal = db
  .prepare(
    `insert into inbox_items (source, source_id, source_url, type, title, desc, author, images, tags, raw, status, frames, created_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  .run(
    "demo",
    "demo-signal-1",
    null,
    "normal",
    "AI 产品面试：Agent 意图识别高频题",
    "（演示数据）整理了一份 Agent 意图识别的基础题清单。",
    "演示作者",
    JSON.stringify([]),
    JSON.stringify(["AI产品经理", "Agent"]),
    "{}",
    "processed",
    "[]",
    now
  );

/* ── 04 题库 ── */
type Q = {
  text: string;
  kind: string;
  scope: "universal" | "domain";
  topicL1: string;
  topic: string;
  cluster: string;
  source: string;
  roleId: number | null;
  inboxItemId: number | null;
  rationale: string;
  exps: number[];
};

const QUESTIONS: Q[] = [
  {
    text: "讲一个你负责的 AI 项目，你的角色和核心指标是什么？",
    kind: "behavioral", scope: "universal",
    topicL1: "Experience & Behavior", topic: "Project Deep-dive",
    cluster: "project_deep_dive", source: "role", roleId: null, inboxItemId: null,
    rationale: "想确认他是不是真主导过，还是只是参与。",
    exps: [expIds[0]],
  },
  {
    text: "为什么想做 AI 产品经理？",
    kind: "behavioral", scope: "universal",
    topicL1: "Experience & Behavior", topic: "Motivation & Fit",
    cluster: "career_motivation", source: "role", roleId: null, inboxItemId: null,
    rationale: "想知道这是想清楚的选择，还是行业热就跟过来。",
    exps: [],
  },
  {
    text: "这个项目里最难、最有成就感的事情是什么？",
    kind: "behavioral", scope: "universal",
    topicL1: "Experience & Behavior", topic: "Project Deep-dive",
    cluster: "hardest_part", source: "role", roleId: null, inboxItemId: null,
    rationale: "挑一个真正影响成功的矛盾，看他讲不讲得清原方案为什么不行。",
    exps: [expIds[0], expIds[1]],
  },
  {
    text: "跨团队推不动的时候你怎么办？举个具体的例子。",
    kind: "behavioral", scope: "universal",
    topicL1: "Experience & Behavior", topic: "Collaboration & Conflict",
    cluster: "cross_team_influence", source: "role", roleId: null, inboxItemId: null,
    rationale: "想听具体做法，不是「加强沟通」这种话。",
    exps: [expIds[2]],
  },
  {
    text: "评测集的 ground truth 从哪来？完全人工标注一定更准吗？",
    kind: "technical", scope: "domain",
    topicL1: "Technical Foundations", topic: "Evaluation & Badcase",
    cluster: "eval_ground_truth", source: "inbox", roleId: null,
    inboxItemId: Number(signal.lastInsertRowid),
    rationale: "这道题能分出「做过评测」和「读过评测」。",
    exps: [expIds[0]],
  },
  {
    text: "你说意图准确率 98%，这个数怎么算的？标注集多大？",
    kind: "technical", scope: "domain",
    topicL1: "Technical Foundations", topic: "Evaluation & Badcase",
    cluster: "metric_provenance", source: "material",
    roleId: Number(roleGeneral.lastInsertRowid), inboxItemId: null,
    rationale: "数字是他简历上写的，我想知道是他定的还是别人给的。",
    exps: [expIds[0]],
  },
  {
    text: "Agent 中为什么不能把用户所有输入都直接丢给大模型处理？",
    kind: "technical", scope: "domain",
    topicL1: "Technical Foundations", topic: "Agent & Intent",
    cluster: "agent_routing", source: "inbox", roleId: null,
    inboxItemId: Number(signal.lastInsertRowid),
    rationale: "考的是有没有想过成本和可控性，不只是能不能跑通。",
    exps: [expIds[0]],
  },
  {
    text: "意图分类的粒度怎么定？太细容易分错、太粗不够用。",
    kind: "technical", scope: "domain",
    topicL1: "Technical Foundations", topic: "Agent & Intent",
    cluster: "intent_granularity", source: "inbox", roleId: null,
    inboxItemId: Number(signal.lastInsertRowid),
    rationale: "这个平衡没有标准答案，想听他的判断依据。",
    exps: [expIds[0]],
  },
  {
    text: "配对 T 检验的 4 个协变量是怎么选的？样本量 14 够不够？",
    kind: "technical", scope: "domain",
    topicL1: "Technical Foundations", topic: "Evaluation & Badcase",
    cluster: "causal_rigor", source: "material",
    roleId: Number(roleGeneral.lastInsertRowid), inboxItemId: null,
    rationale: "想看他知不知道自己那个设计的局限在哪。",
    exps: [expIds[1]],
  },
  {
    text: "调参频率太快导致效果评估无法收敛，你后来怎么处理的？",
    kind: "case", scope: "domain",
    topicL1: "Business & Metrics", topic: "Growth & Conversion",
    cluster: "tuning_cadence", source: "material",
    roleId: Number(roleGeneral.lastInsertRowid), inboxItemId: null,
    rationale: "他简历里自己写了这个坑，想听完整的处理过程。",
    exps: [expIds[2]],
  },
];

const qStmt = db.prepare(
  `insert into questions
   (text, kind, scope, topic_l1, topic, cluster_id, source, role_id, inbox_item_id, rationale, experience_ids, created_at)
   values (?,?,?,?,?,?,?,?,?,?,?,?)`
);
const qIds = QUESTIONS.map((q) =>
  Number(
    qStmt.run(
      q.text, q.kind, q.scope, q.topicL1, q.topic, q.cluster,
      q.source, q.roleId, q.inboxItemId, q.rationale,
      JSON.stringify(q.exps), now
    ).lastInsertRowid
  )
);

// 追问挂到第一道主问题下
for (const t of [
  "你具体负责哪一段？哪些是别人做的？",
  "这个指标是你定的还是团队给的？为什么是这个不是别的？",
]) {
  db.prepare(
    `insert into questions
     (text, kind, scope, topic_l1, topic, cluster_id, source, parent_id, experience_ids, created_at)
     values (?,?,?,?,?,?,?,?,?,?)`
  ).run(t, "behavioral", "universal", "Experience & Behavior", "Project Deep-dive",
    "project_deep_dive", "role", qIds[0], JSON.stringify([expIds[0]]), now);
}

/* ── 答案版本链：一道题练过两版，一道定稿 ── */
const a1 = db
  .prepare(
    `insert into answers (question_id, content, version, note, used_experience_ids, spoken_transcript, status, created_at)
     values (?,?,?,?,?,?,?,?)`
  )
  .run(
    qIds[0],
    "嗯我做的是那个客服的 Agent，就是意图分类那个，然后我们做了两路的抽取，效果还不错。",
    1, "语音陪练", JSON.stringify([expIds[0]]),
    "嗯我做的是那个客服的 Agent，就是意图分类那个，然后我们做了两路的抽取，效果还不错。",
    "draft", now
  );

db.prepare(
  `insert into answers (question_id, content, version, parent_id, note, used_experience_ids, status, created_at)
   values (?,?,?,?,?,?,?,?)`
).run(
  qIds[0],
  "这个项目解决的是客服人力随工单量线性增长的问题——重复问题占六成，但每一条都要人看。\n\n我负责的是意图层到回答框架这一段。核心决策是先做意图二分类再分路抽取，而不是用一个大 prompt 什么都干：业务咨询走知识库检索，系统问题走日志查询，两路正交，出了问题能定位到是哪一路。\n\n指标是我和客服负责人一起定的：平均响应时间和意图准确率。最后做到 29.1 秒和 98%，人工介入率降了四成。",
  2, Number(a1.lastInsertRowid), "开头先给结论，把业务问题说在前面",
  JSON.stringify([expIds[0]]), "keeper", now
);

db.prepare(
  `insert into answers (question_id, content, version, note, used_experience_ids, status, created_at)
   values (?,?,?,?,?,?,?)`
).run(
  qIds[1],
  "不是因为 AI 热。我在做数据分析的时候反复遇到同一件事：结论出来了，但推不动落地。\n\n后来意识到问题不在分析质量，在于我不掌握「让结论变成产品」的那一环。AI 产品尤其明显——模型能力是给定的，真正决定成败的是你怎么把它包成用户愿意用的东西，以及怎么定义「好」。这两件事都是产品的活。",
  1, "语音陪练", JSON.stringify([]), "keeper", now
);

/* ── 02 外部情报的知识条目 ── */
db.prepare(
  `insert into insights (inbox_item_id, kind, title, content, topic_l1, topic, question_id, tags, evidence, evidence_kind, created_at)
   values (?,?,?,?,?,?,?,?,?,?,?)`
).run(
  Number(signal.lastInsertRowid), "approach",
  "先意图识别再路由，不要一个 prompt 干所有事",
  "把用户输入全丢给大模型的问题：响应慢、成本高、容易给出不相关的回复，而且缺乏精细的意图控制。正确做法是先做意图识别和路由，再按识别结果调用对应的工具或模块。",
  "Technical Foundations", "Agent & Intent", qIds[6],
  JSON.stringify([]),
  "正文：Agent 中不应该把用户的所有输入都直接丢给大模型处理，应该先进行意图识别和路由",
  "text", now
);

db.prepare(
  `insert into insights (inbox_item_id, kind, title, content, topic_l1, topic, tags, evidence, evidence_kind, created_at)
   values (?,?,?,?,?,?,?,?,?,?)`
).run(
  Number(signal.lastInsertRowid), "term",
  "意图漂移（Intent Drift）",
  "多轮对话中模型对用户意图的理解发生偏移，通常由长上下文、歧义输入或模型遗忘导致。",
  "Technical Foundations", "Agent & Intent",
  JSON.stringify([]),
  "正文：什么是「意图漂移」？多轮对话中如何避免",
  "text", now
);

/* ── 05 复盘（演示：一场虚构的面试） ── */
const REVIEW: [string, string, string | null, number | null][] = [
  ["讲一个你负责的 AI 项目", "讲了客服 Agent，从业务问题开始", "准备充分，对方追问指标来源时接得住", qIds[0]],
  ["评测集的 ground truth 从哪来", "说了人工标注，但没讲清代表性怎么保证", "没答好，这是评测体系设计的核心问题", qIds[4]],
  ["如果知识库里两篇文档结论冲突怎么办", "只能取最新的", "完全没准备过，现场想的。缺少对冲突处理机制的思考", null],
];
for (const [asked, said, reflect, qid] of REVIEW) {
  db.prepare(
    `insert into interview_qas (question_id, role_id, company, round, asked_text, my_answer, reflection, interviewed_at, created_at)
     values (?,?,?,?,?,?,?,?,?)`
  ).run(qid, Number(roleGeneral.lastInsertRowid), "演示公司 A", "二面/技术面",
    asked, said, reflect, "2026-08-20", now);
}

const count = (t: string) =>
  (db.prepare(`select count(*) c from ${t}`).get() as { c: number }).c;

console.log(`演示库已生成：${out}`);
for (const t of [
  "profile_docs", "experiences", "role_profiles", "role_jds",
  "inbox_items", "questions", "answers", "insights", "interview_qas",
]) {
  console.log(`  ${t.padEnd(16)} ${count(t)}`);
}
db.close();
