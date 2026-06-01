import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_PORT = Number(process.env.BQ_BRIDGE_PORT) || 18733;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}/api`;
const REQUEST_TIMEOUT = 30_000;

async function bridgeFetch(path) {
  const url = `${BRIDGE_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Bridge ${resp.status}: ${body}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

function text(s) {
  return { content: [{ type: "text", text: s }] };
}

function isBridgeDown(e) {
  if (e && typeof e === "object") {
    const cause = e.cause;
    if (cause && (cause.code === "ECONNREFUSED" || cause.code === "ENOTFOUND")) return true;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("Bridge not reachable") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("abort")
  );
}
function err(e) {
  if (isBridgeDown(e)) {
    return { isError: true, content: [{ type: "text", text: "BQ Bridge not running. Launch Minecraft with bq-mcp-bridge mod." }] };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

const DRY_RUN_NOTE = " SAFETY: All write tools are DRY-RUN by default. Pass commit=true to actually apply the change. The mod creates an automatic backup before any commit.";

const server = new McpServer({ name: "bq-mcp-server", version: "1.2.0" });

server.registerTool("bq_health", {
  description: "Check if BetterQuesting bridge is running. Returns quest/questline counts.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const d = await bridgeFetch("/health");
    return text(`BQ Bridge: ${d.status}\nQuests: ${d.quest_count}\nQuestlines: ${d.questline_count}${d.player ? `\nPlayer: ${d.player}` : ""}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_list_questlines", {
  description: "List all quest lines with names, quest counts, and display order.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const d = await bridgeFetch("/questlines");
    const lines = d.questlines.map(l => `[${l.id}] ${l.name} (${l.quest_count} quests, order=${l.order})`);
    return text(`${d.count} questlines:\n${lines.join("\n")}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_get_questline", {
  description: "Get quest line details: name, description, and all quest positions.",
  inputSchema: z.object({ line_id: z.number().int().describe("Quest line ID") }),
}, async (args) => {
  try {
    const d = await bridgeFetch(`/questlines/${args.line_id}`);
    const quests = d.quests.map(q => `  [${q.quest_id}] pos=(${q.pos_x},${q.pos_y})`);
    return text(`${d.name} (id=${d.id}, order=${d.order})\n${d.description}\n\n${d.quests.length} quests:\n${quests.join("\n")}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_get_quest", {
  description: "Get full quest details: name, description, icon, properties, prerequisites, tasks, rewards, and which quest lines it's in.",
  inputSchema: z.object({ quest_id: z.number().int().describe("Quest ID") }),
}, async (args) => {
  try {
    const d = await bridgeFetch(`/quests/${args.quest_id}`);
    const lines = [];
    lines.push(`Quest [${d.id}] ${d.name}`);
    lines.push(`Icon: ${d.icon}`);
    lines.push(`Visibility: ${d.visibility} | Frame: ${d.frame}`);
    lines.push(`Logic: quest=${d.logic_quest} task=${d.logic_task}`);
    if (d.repeat_time !== -1) lines.push(`Repeat: ${d.repeat_time}`);
    if (d.locked_progress) lines.push("Locked Progress: ON");
    if (d.auto_claim) lines.push("Auto Claim: ON");
    if (d.simultaneous) lines.push("Simultaneous: ON");
    if (d.global_share) lines.push("Global Share: ON");
    if (d.silent) lines.push("Silent: ON");
    lines.push("");
    lines.push("Description:");
    lines.push(String(d.description));
    const prereqs = d.prerequisites || [];
    if (prereqs.length > 0) {
      lines.push("");
      lines.push(`Prerequisites (${prereqs.length}):`);
      prereqs.forEach(p => lines.push(`  [${p.id}] ${p.type}`));
    } else {
      lines.push("\nPrerequisites: none (root quest)");
    }
    const tasks = d.tasks || [];
    if (tasks.length > 0) {
      lines.push("");
      lines.push(`Tasks (${tasks.length}):`);
      tasks.forEach(t => lines.push(`  ${t.type}: ${t.name}`));
    }
    const rewards = d.rewards || [];
    if (rewards.length > 0) {
      lines.push("");
      lines.push(`Rewards (${rewards.length}):`);
      rewards.forEach(r => lines.push(`  ${r.type}: ${r.name}`));
    }
    const inLines = d.in_questlines || [];
    if (inLines.length > 0) {
      lines.push("");
      lines.push("In questlines:");
      inLines.forEach(l => lines.push(`  [${l.line_id}] ${l.line_name} at (${l.pos_x},${l.pos_y})`));
    }
    return text(lines.join("\n"));
  } catch (e) { return err(e); }
});

server.registerTool("bq_search_quests", {
  description: "Search quests by name or description (case-insensitive substring match).",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search term"),
    limit: z.number().int().min(1).max(500).default(50).describe("Max results"),
  }),
}, async (args) => {
  try {
    const q = encodeURIComponent(args.query);
    const d = await bridgeFetch(`/quests?q=${q}&limit=${args.limit}`);
    if (d.results.length === 0) return text(`No quests matching "${args.query}"`);
    const results = d.results.map(r => {
      const desc = r.description.length > 80 ? r.description.substring(0, 80) + "..." : r.description;
      return `[${r.id}] ${r.name} — ${desc}`;
    });
    return text(`Found ${d.total} quests (showing ${d.results.length}):\n${results.join("\n")}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_validate", {
  description: "Validate quest structure: broken prerequisites, missing tasks, position overlaps, missing quest references.",
  inputSchema: z.object({
    line_id: z.number().int().min(0).optional().describe("Quest line ID (omit to validate all)"),
  }),
}, async (args) => {
  try {
    const param = args.line_id != null ? `?line_id=${args.line_id}` : "";
    const d = await bridgeFetch(`/validate${param}`);
    if (d.issue_count === 0) return text("Validation passed — 0 issues found.");
    const lines = [`Found ${d.issue_count} issues:\n`];
    const critical = d.issues.filter(i => i.severity === "CRITICAL");
    const warns = d.issues.filter(i => i.severity === "WARN");
    if (critical.length > 0) {
      lines.push(`CRITICAL (${critical.length}):`);
      critical.forEach(i => lines.push(`  [${i.quest_id}] ${i.quest_name || i.questline || ""}: ${i.message}`));
      lines.push("");
    }
    if (warns.length > 0) {
      lines.push(`WARN (${warns.length}):`);
      warns.forEach(i => {
        let extra = "";
        if (i.overlapping_quest_id) extra = ` overlaps [${i.overlapping_quest_id}] at ${i.position}`;
        lines.push(`  [${i.quest_id}] ${i.quest_name || ""}: ${i.message}${extra}`);
      });
    }
    return text(lines.join("\n"));
  } catch (e) { return err(e); }
});

async function writeJson(path, body) {
  const url = `${BRIDGE_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, data };
  } finally {
    clearTimeout(timeout);
  }
}

function commitWarning(d) {
  if (d.commit === true) {
    return ` COMMITTED (req=${d.request_id}, ${d.duration_ms}ms)${d.backup_path ? ` backup=${d.backup_path}` : ""}`;
  }
  return ` DRY-RUN (no changes made) — set commit=true to apply`;
}

server.registerTool("bq_move_quest", {
  description: "Move a quest to a new (x, y) position in its quest line." + DRY_RUN_NOTE,
  inputSchema: z.object({
    quest_id: z.number().int().describe("Quest ID"),
    line_id: z.number().int().describe("Quest line ID"),
    pos_x: z.number().int().describe("New X position"),
    pos_y: z.number().int().describe("New Y position"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change (creates automatic backup)"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/quests/move", args);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    return text(`Quest [${d.quest_id}] ${d.would_change ? "would move" : "no change"} from (${d.old_pos_x},${d.old_pos_y}) to (${d.new_pos_x},${d.new_pos_y}) in quest line ${d.line_id}.${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_set_prerequisites", {
  description: "Set the prerequisite quest IDs for a quest (replaces all existing prereqs)." + DRY_RUN_NOTE,
  inputSchema: z.object({
    quest_id: z.number().int().describe("Quest ID"),
    prerequisites: z.array(z.number().int()).describe("Array of prerequisite quest IDs (empty array for none)"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/quests/prerequisites", args);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    return text(`Quest [${d.quest_id}] prereqs ${d.would_change ? "would change" : "no change"}: [${(d.old_prerequisites || []).join(", ")}] → [${(d.new_prerequisites || []).join(", ")}].${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_update_quest", {
  description: "Update quest name, description, and/or icon. Only provided fields are changed." + DRY_RUN_NOTE,
  inputSchema: z.object({
    quest_id: z.number().int().describe("Quest ID"),
    name: z.string().optional().describe("New quest name"),
    description: z.string().optional().describe("New quest description"),
    icon: z.string().optional().describe("New icon item (format: 'modid:item' or 'modid:item:meta')"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const body = { quest_id: args.quest_id, commit: args.commit };
    if (args.name !== undefined) body.name = args.name;
    if (args.description !== undefined) body.description = args.description;
    if (args.icon !== undefined) body.icon = args.icon;
    const r = await writeJson("/write/quests/update", body);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    const changes = [];
    if (d.new_name) changes.push(`name: "${d.old_name}" → "${d.new_name}"`);
    if (d.new_description) changes.push(`description updated`);
    if (d.new_icon) changes.push(`icon: ${d.new_icon}`);
    return text(`Quest [${d.quest_id}] ${d.would_change ? "would update" : "no change"} (${changes.join(", ") || "no fields specified"}).${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_create_quest", {
  description: "Create a new quest and place it in a quest line." + DRY_RUN_NOTE,
  inputSchema: z.object({
    quest_id: z.number().int().describe("New quest ID (must not already exist)"),
    line_id: z.number().int().describe("Quest line ID to place the quest in"),
    name: z.string().optional().describe("Quest name (default: 'New Quest')"),
    description: z.string().optional().describe("Quest description"),
    pos_x: z.number().int().default(0).describe("X position in quest line"),
    pos_y: z.number().int().default(0).describe("Y position in quest line"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/quests/create", args);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    return text(`Quest [${d.quest_id}] "${d.name}" ${d.would_create ? "would be created" : "exists"} at (${d.pos_x},${d.pos_y}) in quest line ${d.line_id}.${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_delete_quest", {
  description: "Delete a quest. Removes it from all quest lines and from all other quests' prerequisite lists." + DRY_RUN_NOTE,
  inputSchema: z.object({
    quest_id: z.number().int().describe("Quest ID to delete"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/quests/delete", { quest_id: args.quest_id, commit: args.commit });
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    const lines = d.affected_questlines?.length ? ` Affects ${d.affected_questlines.length} questline(s): [${d.affected_questlines.join(", ")}].` : "";
    const prereqs = d.affected_quests_requiring_this?.length ? ` ${d.affected_quests_requiring_this.length} other quest(s) require this: [${d.affected_quests_requiring_this.join(", ")}].` : "";
    return text(`Quest [${d.quest_id}] ${d.would_delete ? "would be deleted" : "not found"}.${lines}${prereqs}${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_reorder_questline", {
  description: "Change a quest line's display order." + DRY_RUN_NOTE,
  inputSchema: z.object({
    line_id: z.number().int().describe("Quest line ID"),
    order: z.number().int().describe("New order index"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/questlines/reorder", args);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    return text(`Quest line [${d.line_id}] ${d.would_change ? "would reorder" : "no change"}: order ${d.old_order} → ${d.new_order}.${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_create_questline", {
  description: "Create a new quest line (added to the end of the order)." + DRY_RUN_NOTE,
  inputSchema: z.object({
    line_id: z.number().int().describe("New quest line ID (must not already exist)"),
    name: z.string().optional().describe("Quest line name (default: 'New Questline')"),
    description: z.string().optional().describe("Quest line description"),
    commit: z.boolean().default(false).describe("Set true to actually apply the change"),
  }),
}, async (args) => {
  try {
    const r = await writeJson("/write/questlines/create", args);
    if (!r.ok) return text(`FAILED: ${r.error}`);
    const d = r.data;
    const orderInfo = d.assigned_order !== undefined ? ` (assigned order ${d.assigned_order})` : "";
    return text(`Quest line [${d.line_id}] "${d.name}" ${d.would_create ? "would be created" : "exists"}${orderInfo}.${commitWarning(d)}`);
  } catch (e) { return err(e); }
});

server.registerTool("bq_save_questbook", {
  description: "Force-save the questbook to disk. Performs pre-write integrity check and logs to audit log. Does NOT create a backup (no pre-existing data is at risk).",
  inputSchema: z.object({}),
}, async () => {
  try {
    const r = await writeJson("/write/save", {});
    if (!r.ok) return text(`FAILED: ${r.error}`);
    return text(`Questbook saved to disk.${commitWarning(r.data)}`);
  } catch (e) { return err(e); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`BQ MCP Server connected via stdio (bridge port ${BRIDGE_PORT})`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
