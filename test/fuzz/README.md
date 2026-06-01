# BQ-MCP Bridge Fuzz Test Suite

Fuzz testing for the BQ-MCP bridge (HTTP + MCP + state integration).

## Running

From the `server` directory:

```bash
npm run test:fuzz
```

Or run individual suites:

```bash
node ../test/fuzz/bq/http-fuzz.mjs   # HTTP bridge (152 cases)
node ../test/fuzz/bq/mcp-fuzz.mjs    # MCP server (96 cases)
node ../test/fuzz/shared/state-integration.mjs  # Cross-bridge workflow (23 cases)
node ../test/fuzz/master.mjs          # All 3 suites
```

## Prerequisites

- BQ-MCP bridge running on `127.0.0.1:18733` (default port)
- JEI-MCP bridge running on `127.0.0.1:18732` (required for state integration tests)
- Node.js 26+ (uses built-in `node:fetch` and `node:child_process`)

## Structure

```
test/fuzz/
├── shared/
│   ├── harness.mjs           # Shared FuzzReport, FUZZ_INPUTS, httpReq, bridgeUp
│   └── state-integration.mjs  # Cross-bridge workflow tests
├── bq/
│   ├── http-fuzz.mjs         # HTTP bridge fuzz (152 cases)
│   └── mcp-fuzz.mjs          # MCP server fuzz (96 cases)
├── master.mjs                # Runs all suites, writes reports/aggregate.json
├── reports/                  # Generated (gitignored)
│   └── aggregate.json
└── .gitignore
```

## Test Coverage

| Suite | Cases | What it tests |
|-------|-------|---------------|
| BQ HTTP | 152 | All `/api/*` endpoints: health, questlines, quests, validate, write endpoints, method tampering, malformed JSON, path traversal, security, concurrency |
| BQ MCP | 96 | MCP protocol: initialize, tools/list, all 14 tools, boundary inputs, unknown tools, JSON-RPC abuse, large payloads, concurrency |
| State Integration | 23 | Cross-bridge: read consistency, dry-run safety, write validation, commit=true workflow, audit log, stress |

## Bugs Found (v1.0.0 → v1.2.1)

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| BUG-A | CRITICAL | BQ HTTP write handlers | `commit=true` write with bad input threw `RuntimeException` from backup, hung client ~30s. Fixed: added `catch (RuntimeException)` returning 500. |
| BUG-B | MEDIUM | BQ MCP server | Node 26 `fetch failed` error not recognized, raw error sent to LLM. Fixed: detect `e.cause?.code === 'ECONNREFUSED'` and `"fetch failed"` in message. |
| BUG-F | LOW | BQ audit log | BACKUP_FAIL events lost exception details. Fixed: include `error_class`, `error_message`, `backup_root` in audit result. |
| BUG-G | CRITICAL | BQ backup source path | Hardcoded `betterquesting/DefaultQuests` but data is in `config/betterquesting/DefaultQuests`. ALL commit=true writes failed. Fixed: corrected path. |

## Test Design Notes

- **Dry-run first**: Write tools default to `commit=false`. Fuzz tests exercise both dry-run and commit paths.
- **Backup-first design**: Bridge always attempts backup before any commit=true write, even for invalid inputs. This is safe but slightly wasteful. Tests that assert "no backup attempted on invalid input" are intentionally failing.
- **CRLF rejection**: Java `HttpServer` rejects CRLF in headers at protocol level (status=0 = connection drop). This is correct security behavior.
- **Response field naming**: `/api/validate` returns `issue_count` (not `count`).
