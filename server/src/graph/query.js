/**
 * High-level read queries against the BQ questbook graph.
 */
import { getDb, getMetaNumber } from "./db.js";
import { ftsEscape } from "./search.js";
import { getUnlocks, getBlockers, prereqDepth } from "./traversal.js";

export function stats() {
  const db = getDb();
  return {
    questline_count: getMetaNumber(db, "questline_count"),
    quest_count:     getMetaNumber(db, "quest_count"),
    task_count:      getMetaNumber(db, "task_count"),
    reward_count:    getMetaNumber(db, "reward_count"),
    prereq_count:    getMetaNumber(db, "prereq_count"),
    generated_at:    db.prepare("SELECT value FROM meta WHERE key = 'generated_at'").get()?.value || null,
    bridge_player:   db.prepare("SELECT value FROM meta WHERE key = 'bridge_player'").get()?.value || null,
  };
}

export function listQuestlines() {
  const db = getDb();
  return db.prepare("SELECT id, name, description, ord, quest_count FROM questlines ORDER BY ord, id").all();
}

export function getQuestline(id) {
  const db = getDb();
  const ql = db.prepare("SELECT id, name, description, ord, quest_count FROM questlines WHERE id = ?").get(id);
  if (!ql) return null;
  const quests = db.prepare(`
    SELECT q.id, q.name, q.frame, m.pos_x, m.pos_y
    FROM questline_membership m
    JOIN quests q ON q.id = m.quest_id
    WHERE m.questline_id = ?
    ORDER BY m.pos_y, m.pos_x
  `).all(id);
  return { ...ql, quests };
}

export function getQuest(id) {
  const db = getDb();
  const q = db.prepare(`
    SELECT id, name, description, icon, visibility, frame,
           logic_quest, logic_task, repeat_time,
           locked_progress, auto_claim, simultaneous, global_share,
           prereq_count, task_count, reward_count, in_questline_count
    FROM quests WHERE id = ?
  `).get(id);
  if (!q) return null;
  q.tasks = db.prepare("SELECT task_id AS id, type, name FROM tasks WHERE quest_id = ? ORDER BY seq").all(id);
  q.rewards = db.prepare("SELECT reward_id AS id, type, name FROM rewards WHERE quest_id = ? ORDER BY seq").all(id);
  q.prerequisites = db.prepare("SELECT prereq_id AS id, type FROM prereqs WHERE quest_id = ? ORDER BY prereq_id").all(id);
  q.in_questlines = db.prepare(`
    SELECT m.questline_id AS line_id, l.name AS line_name, m.pos_x, m.pos_y
    FROM questline_membership m JOIN questlines l ON l.id = m.questline_id
    WHERE m.quest_id = ? ORDER BY l.name
  `).all(id);
  return q;
}

export function searchQuests(query, limit = 50) {
  const db = getDb();
  const escaped = ftsEscape(query);
  if (!escaped) return [];
  return db.prepare(`
    SELECT q.id, q.name, q.description, q.frame, q.prereq_count, q.task_count
    FROM quests_fts f JOIN quests q ON q.id = f.id
    WHERE quests_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(escaped, limit);
}

export function getDependencies(questId, maxNodes = 1000) {
  // "what does this quest unlock?" — return prereq_id -> quest_id reverse
  const db = getDb();
  const out = getUnlocks(questId, maxNodes);
  if (out.length === 0) return { quest_id: questId, unlocks: [], count: 0 };
  const ids = out.map(o => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, name FROM quests WHERE id IN (${placeholders})`).all(...ids);
  const nameMap = new Map(rows.map(r => [r.id, r.name]));
  return {
    quest_id: questId,
    unlocks: out.map(o => ({ id: o.id, name: nameMap.get(o.id) || `?${o.id}`, depth: o.depth })),
    count: out.length,
  };
}

export function getBlockersFull(questId, maxNodes = 1000) {
  const db = getDb();
  const out = getBlockers(questId, maxNodes);
  if (out.length === 0) return { quest_id: questId, blockers: [], count: 0 };
  const ids = out.map(o => o.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, name FROM quests WHERE id IN (${placeholders})`).all(...ids);
  const nameMap = new Map(rows.map(r => [r.id, r.name]));
  return {
    quest_id: questId,
    blockers: out.map(o => ({ id: o.id, name: nameMap.get(o.id) || `?${o.id}`, depth: o.depth })),
    count: out.length,
  };
}

export function depth(questId) {
  return prereqDepth(questId);
}
