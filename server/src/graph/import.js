import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, initSchema, clearGraph, closeDb, setMeta, validateGraph } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_DIR = process.env.BQ_GRAPH_DIR || join(__dirname, "../../../bq-graph");

async function importGraph() {
  const t0 = Date.now();
  const snapshotPath = join(GRAPH_DIR, "questbook.json");
  if (!existsSync(snapshotPath)) {
    console.error(`Missing questbook.json in ${GRAPH_DIR}`);
    process.exit(1);
  }

  console.log("Loading questbook.json...");
  let snap;
  try {
    snap = JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch (e) {
    console.error(`Failed to parse questbook.json: ${e.message}`);
    process.exit(1);
  }

  const questlines = snap.questlines || [];
  const quests = snap.quests || {};
  const questIds = Object.keys(quests).map(Number).sort((a, b) => a - b);
  console.log(`  Loaded ${questlines.length} questlines, ${questIds.length} quests in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const db = getDb();
  initSchema(db);
  clearGraph(db);

  const insQuestline = db.prepare(`
    INSERT INTO questlines (id, name, description, ord, quest_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insQuest = db.prepare(`
    INSERT OR IGNORE INTO quests (id, name, description, icon, visibility, frame, logic_quest, logic_task, repeat_time, locked_progress, auto_claim, simultaneous, global_share, prereq_count, task_count, reward_count, in_questline_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insTask = db.prepare(`INSERT INTO tasks (task_id, quest_id, type, name) VALUES (?, ?, ?, ?)`);
  const insReward = db.prepare(`INSERT INTO rewards (reward_id, quest_id, type, name) VALUES (?, ?, ?, ?)`);
  const insPrereq = db.prepare(`INSERT OR IGNORE INTO prereqs (quest_id, prereq_id, type) VALUES (?, ?, ?)`);
  const insMembership = db.prepare(`INSERT OR IGNORE INTO questline_membership (quest_id, questline_id, pos_x, pos_y) VALUES (?, ?, ?, ?)`);
  const insFts = db.prepare(`INSERT INTO quests_fts (id, name, description) VALUES (?, ?, ?)`);

  let taskTotal = 0, rewardTotal = 0, prereqTotal = 0, ftsTotal = 0, skippedQuests = 0, phantomQuests = 0;

  // First, gather all prereq references to detect phantom quests
  const knownIds = new Set(questIds);
  const phantomIds = new Set();
  for (const qid of questIds) {
    const q = quests[qid];
    for (const p of q?.prerequisites || []) {
      if (!knownIds.has(p.id)) { phantomIds.add(p.id); knownIds.add(p.id); }
    }
  }

  db.exec("BEGIN");
  try {
    for (const ql of questlines) {
      insQuestline.run(ql.id, ql.name, ql.description || "", ql.order || 0, ql.quests?.length || 0);
    }
    // Phase 1: insert ALL quests first (phantoms + real), so subsequent FKs resolve
    for (const pid of phantomIds) {
      insQuest.run(
        pid, `(phantom quest ${pid})`, "[prereq target not in any questline — likely deleted]", null,
        null, null, null, null, -1, 0, 0, 0, 0, 0, 0, 0, 0
      );
      phantomQuests++;
    }
    for (const qid of questIds) {
      const q = quests[qid];
      if (!q || !q.name) { skippedQuests++; continue; }
      insQuest.run(
        q.id, q.name, q.description || "", q.icon || null,
        q.visibility, q.frame, q.logic_quest, q.logic_task,
        q.repeat_time != null ? q.repeat_time : -1,
        q.locked_progress ? 1 : 0, q.auto_claim ? 1 : 0,
        q.simultaneous ? 1 : 0, q.global_share ? 1 : 0,
        (q.prerequisites || []).length, (q.tasks || []).length,
        (q.rewards || []).length, (q.in_questlines || []).length
      );
    }
    // Phase 2: tasks, rewards, prereqs, memberships, FTS — now that all quests exist
    for (const qid of questIds) {
      const q = quests[qid];
      if (!q || !q.name) continue;
      for (const t of q.tasks || []) {
        try { insTask.run(t.id, qid, t.type || "unknown", t.name || ""); taskTotal++; }
        catch (e) { throw new Error(`task insert failed for quest ${qid}, task ${t.id}: ${e.message}`); }
      }
      for (const r of q.rewards || []) {
        try { insReward.run(r.id, qid, r.type || "unknown", r.name || ""); rewardTotal++; }
        catch (e) { throw new Error(`reward insert failed for quest ${qid}, reward ${r.id}: ${e.message}`); }
      }
      for (const p of q.prerequisites || []) {
        try { insPrereq.run(qid, p.id, p.type != null ? p.type : 0); prereqTotal++; }
        catch (e) { throw new Error(`prereq insert failed for quest ${qid}, prereq ${p.id}: ${e.message}`); }
      }
      for (const m of q.in_questlines || []) {
        try { insMembership.run(qid, m.line_id, m.pos_x || 0, m.pos_y || 0); }
        catch (e) { throw new Error(`membership insert failed for quest ${qid}, line ${m.line_id}: ${e.message}`); }
      }
      insFts.run(qid, q.name, q.description || "");
      ftsTotal++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error(`Insert failed: ${e.message}`);
    process.exit(1);
  }

  console.log(`  Inserted ${questlines.length} questlines`);
  console.log(`  Inserted ${questIds.length - skippedQuests} quests (skipped ${skippedQuests}, ${phantomQuests} phantoms)`);
  console.log(`  Inserted ${taskTotal} tasks, ${rewardTotal} rewards, ${prereqTotal} prereqs`);
  console.log(`  Indexed ${ftsTotal} quests in FTS5`);

  console.log("Writing metadata...");
  setMeta(db, "generated_at", snap.generated_at || new Date().toISOString());
  setMeta(db, "bridge_player", snap.bridge?.player || "");
  setMeta(db, "questline_count", questlines.length);
  setMeta(db, "quest_count", questIds.length - skippedQuests);
  setMeta(db, "task_count", taskTotal);
  setMeta(db, "reward_count", rewardTotal);
  setMeta(db, "prereq_count", prereqTotal);

  console.log("Validating graph...");
  const v = validateGraph(db);
  console.log(`  ${v.ok ? "OK" : "ISSUES"}: ${v.counts.questlines} questlines, ${v.counts.quests} quests, ${v.counts.tasks} tasks, ${v.counts.rewards} rewards, ${v.counts.prereqs} prereqs, ${v.counts.memberships} memberships`);
  if (!v.ok) {
    for (const i of v.issues) console.log(`    ! ${i}`);
  }
  closeDb();
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

importGraph().catch(e => { console.error(e); process.exit(1); });
