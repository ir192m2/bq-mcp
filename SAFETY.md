# Safety Model

## Threat Model

The BQ MCP bridge mutates **in-memory** BetterQuesting state (`QuestDatabase.INSTANCE`, `QuestLineDatabase.INSTANCE`). These are Java singletons shared between the integrated server and the local client. Disk writes only happen when **Minecraft itself saves the world** — the bridge never writes to disk directly.

**This means the bridge is reversible by default**: if you don't save the world, your changes are lost on MC exit. The bridge is essentially a structured editor for the in-memory questbook.

## Safety Guarantees (v1.2.0+)

1. **No bulk sync.** The `NetBulkSync.sendSync` call was removed entirely. Per-write `markDirty()` is the only post-write state change. The user's questbook UI is never sent a sync packet mid-edit. (This was the cause of the original questbook corruption.)
2. **Dry-run by default.** Every write tool requires `commit=true` to mutate. Without `commit`, the API returns a diff ("what would change") without touching state.
3. **In-memory isolation.** Bridge mutations only affect `QuestDatabase.INSTANCE` and `QuestLineDatabase.INSTANCE`. Disk files (`config/betterquesting/DefaultQuests/`, `saves/<world>/betterquesting/`) are written only by MC's own save cycle, which the user controls.
4. **Pre-write backup.** When `commit=true`, a timestamped copy of `config/betterquesting/DefaultQuests/` is made to `config/bqmcp/backups/<timestamp>-<n>/` BEFORE any mutation. Useful if the user accidentally saves the world with bad state.
5. **Audit log.** Every write (including dry-runs and aborts) is logged to `config/bqmcp/audit.log` as one JSON object per line. Fields: `ts`, `request_id`, `operation`, `event`, `params`, `result`.
6. **Pre/post integrity check.** After any `commit=true` write, `BqWriteSafety.assertConsistent()` walks `QuestDatabase` and `QuestLineDatabase` asserting no nulls and that `getEntries().size() == size()`. If inconsistent, an exception is thrown, `INTEGRITY_FAIL` is logged, and the request returns an error.
7. **Game thread isolation.** All writes are scheduled on the game thread via `MinecraftServer.addScheduledTask` with a 10s timeout. No concurrent mutation of BQ state from the HTTP thread.
8. **Log4j audit channel.** Write events are also emitted to the `bqmcp_audit` log4j logger for centralized aggregation.

## Operating Procedure

1. **Always start with a dry-run.** Review the diff in the response. No state change, no risk.
2. **Only after dry-run looks correct**, re-issue with `commit=true`. This mutates in-memory state.
3. **Look at the result in-game** (open the questbook, check positions, etc.). The bridge does not refresh the questbook UI, so you may need to close+reopen the quest screen to see changes.
4. **If happy**: save the world normally (Esc → Save and Quit to Title, or let autosave fire).
5. **If unhappy**: quit to title **without saving**. All in-memory changes are lost. Restart MC and the questbook is back to its on-disk state.
6. **Optionally check `config/bqmcp/audit.log`** to see a record of every change made.

## Recovery Procedures

### In-memory state looks wrong
1. **Quit to title** in Minecraft. Do NOT save the world.
2. Done. Restart MC and the in-memory state is fresh from disk.

### Saved world with bad state
This is the bad case. MC has written the bad in-memory state to both `config/betterquesting/DefaultQuests/` AND `saves/<world>/betterquesting/`.
1. Quit MC immediately.
2. List backups: `ls -la config/bqmcp/backups/` — the most recent one is the pre-write snapshot of DefaultQuests.
3. Restore DefaultQuests: `rm -rf config/betterquesting/DefaultQuests && cp -r config/bqmcp/backups/<backup-id> config/betterquesting/DefaultQuests`
4. For the world save, restore from FTB Backups (if configured) or from your own backup.
5. Restart MC.

### Questbook UI shows stale data after a commit
Close and reopen the questbook. The bridge doesn't trigger a UI refresh.

## Port Configuration

Both bridge ports are configurable. Resolution order (first wins):
1. `config/{bqmcp,jeimcp}/bridge.properties` with `port=N`
2. System property `bqmcp.bridge.port` or `jeimcp.bridge.port`
3. Env var `BQ_BRIDGE_PORT` or `JEI_BRIDGE_PORT`
4. Default (18733 / 18732)

The MCP server reads `BQ_BRIDGE_PORT` / `JEI_BRIDGE_PORT` from env when launched.

For multi-instance setups, copy the instance and give the copy a `config/bqmcp/bridge.properties` with a different port.

## API Contract

All write endpoints return a response with:
- `ok: true|false`
- `request_id`: unique correlation ID
- `duration_ms`: server-side timing
- `commit: true|false` — whether the change was applied
- `dry_run: true|false` — inverse of commit
- `backup_path`: path to the pre-write backup (only when commit=true)
- Operation-specific fields: `old_*`, `new_*`, `would_change`, etc.

If `commit=false` (default), no mutation occurs. The response describes what WOULD happen.

## Code Layout

- `BqWriteApi.java` — public write API. Each method takes `commit: boolean`.
- `BqWriteSafety.java` — backup, audit log, integrity check. No public mutation.
- `BqHttpBridgeServer.java` — HTTP transport. Parses `commit` from JSON body.
- `server/dist/index.js` — MCP transport. Exposes `commit` as a tool param with default `false`.
