import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

function resolveDbPath(dbPath) {
  if (dbPath) return dbPath;
  const env = process.env.BQ_GRAPH_DB;
  if (env) return env;
  return join(__dirname, "../../../bq-graph/questgraph.db");
}

export function getDb(dbPath) {
  if (_db) return _db;
  const p = resolveDbPath(dbPath);
  _db = new DatabaseSync(p);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec("PRAGMA synchronous=NORMAL");
  _db.exec("PRAGMA foreign_keys=ON");
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questlines (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      ord         INTEGER NOT NULL DEFAULT 0,
      quest_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quests (
      id             INTEGER PRIMARY KEY,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      icon           TEXT,
      visibility     INTEGER,
      frame          INTEGER,
      logic_quest    INTEGER,
      logic_task     INTEGER,
      repeat_time    INTEGER,
      locked_progress INTEGER NOT NULL DEFAULT 0,
      auto_claim     INTEGER NOT NULL DEFAULT 0,
      simultaneous   INTEGER NOT NULL DEFAULT 0,
      global_share   INTEGER NOT NULL DEFAULT 0,
      prereq_count   INTEGER NOT NULL DEFAULT 0,
      task_count     INTEGER NOT NULL DEFAULT 0,
      reward_count   INTEGER NOT NULL DEFAULT 0,
      in_questline_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      quest_id INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_quest ON tasks(quest_id);

    CREATE TABLE IF NOT EXISTS rewards (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      reward_id INTEGER NOT NULL,
      quest_id INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_rewards_quest ON rewards(quest_id);

    -- prerequisites: prereq_id is required to complete quest_id
    CREATE TABLE IF NOT EXISTS prereqs (
      quest_id   INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      prereq_id  INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      type       INTEGER NOT NULL,
      PRIMARY KEY (quest_id, prereq_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prereqs_q ON prereqs(quest_id);
    CREATE INDEX IF NOT EXISTS idx_prereqs_p ON prereqs(prereq_id);

    -- questline_membership: many-to-many with positions
    CREATE TABLE IF NOT EXISTS questline_membership (
      quest_id     INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      questline_id INTEGER NOT NULL REFERENCES questlines(id) ON DELETE CASCADE,
      pos_x        INTEGER NOT NULL DEFAULT 0,
      pos_y        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (quest_id, questline_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qlm_line ON questline_membership(questline_id);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS quests_fts USING fts5(
      id UNINDEXED,
      name,
      description,
      tokenize='porter unicode61'
    );
  `);
}

export function clearGraph(db) {
  db.exec("DELETE FROM quests_fts");
  db.exec("DELETE FROM questline_membership");
  db.exec("DELETE FROM prereqs");
  db.exec("DELETE FROM rewards");
  db.exec("DELETE FROM tasks");
  db.exec("DELETE FROM quests");
  db.exec("DELETE FROM questlines");
  db.exec("DELETE FROM meta");
}

export function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, String(value));
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function getMetaNumber(db, key) {
  const v = getMeta(db, key);
  return v == null ? 0 : Number(v);
}

export function validateGraph(db) {
  const issues = [];
  const counts = {
    questlines: db.prepare("SELECT COUNT(*) as c FROM questlines").get().c,
    quests: db.prepare("SELECT COUNT(*) as c FROM quests").get().c,
    tasks: db.prepare("SELECT COUNT(*) as c FROM tasks").get().c,
    rewards: db.prepare("SELECT COUNT(*) as c FROM rewards").get().c,
    prereqs: db.prepare("SELECT COUNT(*) as c FROM prereqs").get().c,
    memberships: db.prepare("SELECT COUNT(*) as c FROM questline_membership").get().c,
  };
  const orphanPrereq = db.prepare("SELECT COUNT(*) as c FROM prereqs p WHERE NOT EXISTS (SELECT 1 FROM quests q WHERE q.id = p.prereq_id)").get().c;
  if (orphanPrereq > 0) issues.push(`${orphanPrereq} prereqs reference missing quests`);
  return { ok: issues.length === 0, issues, counts };
}
