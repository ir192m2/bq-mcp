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

## File Structure

```
bq-mcp/
├── mod/
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradlew
│   └── src/main/java/com/bqmcp/bridge/
│       ├── BqMcpBridgeMod.java
│       └── http/BqHttpBridgeServer.java
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts
├── .gitignore
└── README.md
```
