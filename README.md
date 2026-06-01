# BQ MCP Bridge

Bridges [BetterQuesting](https://github.com/CleanroomMC/BetterQuesting) (1.12.2) to [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing AI assistants to read, validate, and safely write quest data from a running game instance.

**v1.2.x** — Production-grade write safety: dry-run by default, opt-in `commit=true`, automatic backups, audit log, post-write integrity check.

## Architecture

```
KiloCode ──MCP stdio──> bq-mcp-server (TypeScript) ──HTTP 127.0.0.1:18733──> Minecraft Client (BQ mod)
```

## Setup

### Prerequisites

- Minecraft 1.12.2 with Forge
- BetterQuesting Unofficial 4.3.2+
- JDK 21 (for Gradle)
- Node.js 18+ (for MCP server)

### 1. Build the Mod

The mod depends on BetterQuesting via CurseMaven. If CurseMaven doesn't resolve the BQ jar, download it manually and place it in `mod/libs/`:

```bash
# Option A: CurseMaven (auto)
cd mod
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew build

# Option B: Manual dependency
mkdir -p mod/libs
cp path/to/BetterQuestingUnofficial-4.3.2.jar mod/libs/
# Then change build.gradle: use files("libs/BetterQuestingUnofficial-4.3.2.jar") instead of rfg.deobf(...)
cd mod
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew build
```

Output: `mod/build/libs/bq-mcp-bridge-1.0.0.jar`

Place in your Minecraft `mods/` folder.

### 2. Build the MCP Server

```bash
cd server
npm install
npm run build
# Output: dist/index.js
```

### 3. Configure KiloCode

Add to `.kilo/kilo.jsonc`:

```jsonc
"bq-mcp": {
  "command": "node",
  "args": ["/absolute/path/to/bq-mcp/server/dist/index.js"]
}
```

## Usage

1. Launch Minecraft with BetterQuesting and the BQ MCP Bridge mod
2. Join a world — HTTP server starts on `127.0.0.1:18733`
3. Use the MCP tools

```bash
curl http://127.0.0.1:18733/api/health
# {"status":"ok","quest_count":416,"questline_count":23}
```

## MCP Tools (v1.2.0 — 14 tools)

### Read-only (6)

| Tool | Description |
|------|-------------|
| `bq_health` | Bridge status + quest/questline counts |
| `bq_list_questlines` | All quest lines with names, descriptions, counts |
| `bq_get_questline` | Quest line detail + all quest positions |
| `bq_get_quest` | Full quest: name, desc, icon, properties, prereqs, tasks, rewards, questline memberships |
| `bq_search_quests` | Search by name/description text |
| `bq_validate` | Check for broken prereqs, missing tasks, overlaps, missing quest refs |

### Write (8) — DRY-RUN by default, pass `commit=true` to apply

| Tool | Description |
|------|-------------|
| `bq_move_quest` | Move a quest to new (x, y) position |
| `bq_set_prerequisites` | Set prerequisite quest IDs |
| `bq_update_quest` | Update name, description, icon |
| `bq_create_quest` | Create a new quest in a quest line |
| `bq_delete_quest` | Delete a quest (removes from all questlines + prereq lists) |
| `bq_reorder_questline` | Change a quest line's display order |
| `bq_create_questline` | Create a new quest line |
| `bq_save_questbook` | Force-save questbook to disk |

## HTTP API

### Read endpoints

| Endpoint | Method | Params | Description |
|----------|--------|--------|-------------|
| `/health` | GET | — | Health + quest/questline counts |
| `/questlines` | GET | — | List all quest lines |
| `/questlines/<id>` | GET | — | Quest line details + positions |
| `/quests/<id>` | GET | — | Full quest details |
| `/quests` | GET | `q`, `limit`, `offset` | Search quests |
| `/validate` | GET | `line_id` | Validate structure |

### Write endpoints (all POST, body = JSON)

| Endpoint | Body | Description |
|----------|------|-------------|
| `/write/quests/move` | `{quest_id, line_id, pos_x, pos_y, commit}` | Move quest |
| `/write/quests/prerequisites` | `{quest_id, prerequisites[], commit}` | Set prereqs |
| `/write/quests/update` | `{quest_id, name?, description?, icon?, commit}` | Update quest |
| `/write/quests/create` | `{quest_id, line_id, name?, description?, pos_x?, pos_y?, commit}` | Create quest |
| `/write/quests/delete` | `{quest_id, commit}` | Delete quest |
| `/write/questlines/reorder` | `{line_id, order, commit}` | Reorder questline |
| `/write/questlines/create` | `{line_id, name?, description?, commit}` | Create questline |
| `/write/save` | `{}` | Force-save to disk |

## Safety Model (v1.2.0)

**All write tools are DRY-RUN by default.** Pass `commit: true` to actually apply.

When `commit=true`:
1. **Pre-write backup**: `config/betterquesting/DefaultQuests/` is copied to `bqmcp/backups/<requestId>/`
2. **Write executes** on the game thread
3. **Post-write integrity check**: verifies quest/questline database consistency
4. **`markDirty()`** flags the BQ databases for save on next world save
5. **Audit log** records BEGIN / DRY_RUN / COMMIT / BACKUP_FAIL / INTEGRITY_FAIL / ABORT

**In-memory only**: Changes are NOT persisted to disk until you call `bq_save_questbook` or Minecraft auto-saves the world. To discard changes, quit the world without saving.

**Audit log**: `bqmcp/audit.log` (JSONL format, one event per line)
**Backups**: `bqmcp/backups/<requestId>/`

## Technical Details

- **HTTP:** Java `com.sun.net.httpserver.HttpServer`
- **BQ Access:** Direct singleton access (`QuestDatabase.INSTANCE`, `QuestLineDatabase.INSTANCE`)
- **Binding:** `127.0.0.1:18733` (localhost only)
- **Read + Write** — v1.2.0 adds production-grade write safety
- **MCP Server:** TypeScript with `@modelcontextprotocol/sdk`, Zod schema validation
- **Thread Safety:** BQ queries run on Minecraft server thread via `MinecraftServer.addScheduledTask()` + `CompletableFuture`
- **Text Output:** MCP tools return concise parsed text (not raw JSON) to minimize token usage

## File Structure

```
bq-mcp/
├── mod/
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradlew
│   ├── libs/                          # Local BQ dependency (user-provided)
│   │   └── BetterQuestingUnofficial-4.3.2.jar
│   └── src/main/java/com/bqmcp/bridge/
│       ├── BqMcpBridgeMod.java        # @Mod entry, server lifecycle
│       ├── BqWriteApi.java            # 8 write methods (dry-run + commit)
│       ├── BqWriteSafety.java         # backup, audit, integrity wrapper
│       └── http/BqHttpBridgeServer.java  # 14 HTTP handlers (6 read + 8 write)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── dist/index.js                  # MCP server (compiled)
│   └── src/index.ts                   # MCP server source
├── test/
│   └── fuzz/                          # Fuzz test suite (271 cases)
│       ├── shared/                    # harness, state integration
│       ├── bq/                        # HTTP + MCP fuzzers
│       ├── master.mjs                 # runs all suites
│       └── README.md
├── .gitignore
└── README.md
```

## Testing

### Fuzz Test Suite (271 cases)

```bash
cd server
npm run test:fuzz
```

| Suite | Cases | Target |
|-------|-------|--------|
| BQ HTTP | 152 | Java mod HTTP API (`:18733`) |
| BQ MCP | 96 | MCP server via JSON-RPC stdio |
| State Integration | 23 | Cross-bridge workflow |

See `test/fuzz/README.md` for details, individual suite runners, and bug history.

### Unit Tests

```bash
cd mod
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew test
```

25 tests covering `BridgeConfig` and `BqWriteSafety`.

## Known Limitations

- Non-numeric IDs (e.g. `/questlines/abc`) return HTTP 400 instead of 404
- Empty search queries return HTTP 400 (correct behavior)
- URL-encoded `&` in search queries (`%26`) triggers query string splitting
- Bridge always attempts backup before `commit=true` write, even for invalid inputs (safe but slightly wasteful)
