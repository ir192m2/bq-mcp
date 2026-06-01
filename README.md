# BQ MCP Bridge

Bridges [BetterQuesting](https://github.com/CleanroomMC/BetterQuesting) (1.12.2) to [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing AI assistants to read and validate quest data from a running game instance.

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `bq_health` | Bridge status + quest/questline counts |
| `bq_list_questlines` | All quest lines with names, descriptions, counts |
| `bq_get_questline` | Quest line detail + all quest positions |
| `bq_get_quest` | Full quest: name, desc, icon, properties, prereqs, tasks, rewards, questline memberships |
| `bq_search_quests` | Search by name/description text |
| `bq_validate` | Check for broken prereqs, missing tasks, overlaps, missing quest refs |

## HTTP API

| Endpoint | Method | Params | Description |
|----------|--------|--------|-------------|
| `/health` | GET | — | Health + quest/questline counts |
| `/questlines` | GET | — | List all quest lines |
| `/questlines/<id>` | GET | — | Quest line details + positions |
| `/quests/<id>` | GET | — | Full quest details |
| `/quests` | GET | `q`, `limit`, `offset` | Search quests |
| `/validate` | GET | `line_id` | Validate structure |

## Technical Details

- **HTTP:** Java `com.sun.net.httpserver.HttpServer`
- **BQ Access:** Direct singleton access (`QuestDatabase.INSTANCE`, `QuestLineDatabase.INSTANCE`)
- **Binding:** `127.0.0.1:18733` (localhost only)
- **Read-only** — Phase 1, no write operations
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
│       └── http/BqHttpBridgeServer.java  # 6 HTTP handlers
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── dist/
│   │   ├── index.js                   # MCP server (compiled)
│   │   ├── fuzz-test.js               # HTTP API fuzz tests (101 tests)
│   │   └── mcp-fuzz.js                # MCP protocol fuzz tests (42 tests)
│   └── src/index.ts                   # MCP server source
├── .gitignore
└── README.md
```

## Testing

### Fuzz Test Suites

Two independent test suites cover the full stack:

| Suite | Target | Tests | File |
|-------|--------|-------|------|
| HTTP fuzz | Java mod HTTP API (`:18733`) | 101 | `server/dist/fuzz-test.js` |
| MCP protocol | MCP server via JSON-RPC stdio | 42 | `server/dist/mcp-fuzz.js` |

**Run them:**
```bash
cd server
node dist/fuzz-test.js    # HTTP API tests
node dist/mcp-fuzz.js     # MCP protocol tests
```

### HTTP Fuzz Tests (101 tests)

| Category | Tests | Coverage |
|----------|-------|----------|
| Health | 5 | Status, quest count, questline count, player name |
| Questlines | 18 | Count, array, fields, known lines (Main Path, Adv Rocketry, Thermal) |
| Questline detail | 14 | Valid lines, name, id, description, quest positions, non-existent lines |
| Quest detail | 21 | Valid quests, name, icon, visibility, frame, logic, tasks, rewards, prerequisites, questline memberships |
| Search | 13 | Case-insensitive, limit, partial match, no results, empty query |
| Validate | 10 | Issue count, severity, message, per-line validation, non-existent lines |
| Edge cases | 11 | Special chars, unicode, XSS, SQL injection, path traversal, null bytes, long queries, huge/negative IDs |
| HTTP methods | 4 | POST/PUT/DELETE rejected with 405 |
| Performance | 3 | 10 parallel searches, 5 concurrent mixed endpoints |
| Data consistency | 6 | Health/questline count match, questline sum≈total, quest↔questline cross-reference |

### MCP Protocol Tests (42 tests)

| Category | Tests | Coverage |
|----------|-------|----------|
| Protocol | 2 | Initialize handshake, server info |
| Tool discovery | 7 | All 6 tools advertised, names match |
| Health | 3 | Non-error, text content, quest count |
| Questlines | 5 | List all, known lines, non-existent lines |
| Quest detail | 6 | Root quests, prerequisites, tasks, error handling |
| Search | 5 | Valid queries, case-insensitive, no results |
| Validate | 3 | Full validation, per-line, non-existent line |
| Edge cases | 4 | XSS-like, long queries, extra params |
| Concurrency | 1 | 4 rapid parallel calls |
| Error handling | 2 | Non-existent quests/questlines return errors |

### Known Limitations

- Non-numeric IDs (e.g. `/questlines/abc`) return HTTP 400 instead of 404
- Empty search queries return HTTP 400 (correct behavior)
- URL-encoded `&` in search queries (`%26`) triggers query string splitting
