# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-06-01

### Added
- **Offline SQLite + FTS5 questbook graph engine** (no JVM required for queries)
  - Schema: `quests`, `questlines`, `tasks`, `rewards`, `prereqs`, `questline_membership`, `meta`, `quests_fts`
  - Phantom quest auto-insertion for orphan prereq references
  - Two-phase insert: quests first, then dependent rows (FK-safe)
- 10 new offline MCP tools: `bq_graph_health`, `bq_graph_list_questlines`, `bq_graph_get_questline`, `bq_graph_get_quest`, `bq_graph_search_quests`, `bq_graph_get_dependencies`, `bq_graph_get_blockers`, `bq_graph_find_path`, `bq_graph_detect_cycles`, `bq_graph_depth`
- Graph engine modules: `db.js`, `import.js`, `query.js`, `traversal.js`, `search.js`
- 23 graph engine smoke tests at `server/test/graph-smoke.mjs`
- Graph export script: `server/scripts/export-graph.mjs`
- npm scripts: `graph:export`, `graph:import`
- CHANGELOG.md and LICENSE (MIT) at repo root
- `docs/MCP-SETUP.md` hoisted from per-repo README duplication

### Fixed
- `getMeta(db, key)` now passes the key argument (was returning the first row regardless)
- Task and reward table schemas use autoincrement `seq` primary key (BQ bridge reuses id=0 across all tasks)
- `resolveDbPath` no longer requires the DB file to exist (lets import create it)

## [1.0.0] - 2026-06-01

### Added
- BetterQuesting MCP bridge mod with 14 MCP tools and 14 HTTP endpoints
- Read tools: `bq_health`, `bq_list_questlines`, `bq_get_questline`, `bq_get_quest`, `bq_search_quests`, `bq_validate`
- Write tools (production-grade safety): `bq_create_quest`, `bq_update_quest`, `bq_delete_quest`, `bq_create_task`, `bq_update_task`, `bq_delete_task`, `bq_create_reward`, `bq_delete_reward`, `bq_add_prerequisite`, `bq_remove_prerequisite`, `bq_save_to_disk`
- All write tools require explicit `commit: boolean` — default false (dry-run)
- Pre-write backup of `config/betterquesting/DefaultQuests/` to `bqmcp/backups/<requestId>/`
- JSONL audit log at `bqmcp/audit.log` with `BEGIN/DRY_RUN/COMMIT/ABORT/ERROR` events
- All writes run on Minecraft server thread via `MinecraftServer.addScheduledTask` + `Future.get(timeout)`
- `meta` table in audit log entries includes `request_id`, `duration_ms`, `commit`, `dry_run`, `backup_path`
- Fuzz test suite: 271 cases across HTTP, MCP, and state-integration suites
- 25 Java unit tests for `BridgeConfig` and `BqWriteSafety`
- All write handlers catch `RuntimeException` and return 500 (not hang)
- `bq_health` HTTP endpoint exposes `quest_count`, `questline_count`, `player`

### Fixed
- **BUG-A (CRITICAL)**: 8 BQ write handlers + SaveHandler now catch `RuntimeException`
- **BUG-B (MEDIUM)**: `isBridgeDown()` detects `ECONNREFUSED`/`ENOTFOUND`/`fetch failed`
- **BUG-F (LOW)**: `BACKUP_FAIL` audit now includes `error_class`, `error_message`, `backup_root`
- **BUG-G (CRITICAL)**: `DEFAULT_QUEST_REL` corrected from `"betterquesting/DefaultQuests"` to `"config/betterquesting/DefaultQuests"`
- Input type validation: `requireInt`/`optInt`/`optString`/`optIntArray` check JSON primitive types
- Negative-number string and missing-required-field paths return 400 (not 500)

## [0.1.0] - 2026-05-12

### Added
- Initial scaffold: mod, MCP server, in-memory BQ access via `QuestDatabase.INSTANCE` / `QuestLineDatabase.INSTANCE`
