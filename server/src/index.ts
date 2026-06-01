import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_PORT = 18733;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}/api`;
const REQUEST_TIMEOUT = 30_000;

async function bridgeFetch<T>(path: string): Promise<T> {
  const url = `${BRIDGE_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Bridge ${resp.status}: ${body}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function isBridgeDown(e: unknown): boolean {
  if (e && typeof e === "object") {
    const cause = (e as { cause?: { code?: string } }).cause;
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

function err(e: unknown) {
  if (isBridgeDown(e)) {
    return { isError: true, content: [{ type: "text" as const, text: "BQ Bridge not running. Launch Minecraft with bq-mcp-bridge mod." }] };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

const server = new McpServer({ name: "bq-mcp-server", version: "1.0.0" });

// ===== bq_health =====
server.registerTool("bq_health", {
  description: "Check if BetterQuesting bridge is running. Returns quest/questline counts.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const d = await bridgeFetch<{ status: string; quest_count: number; questline_count: number; player?: string }>("/health");
    return text(`BQ Bridge: ${d.status}\nQuests: ${d.quest_count}\nQuestlines: ${d.questline_count}${d.player ? `\nPlayer: ${d.player}` : ""}`);
  } catch (e) { return err(e); }
});

// ===== bq_list_questlines =====
server.registerTool("bq_list_questlines", {
  description: "List all quest lines with names, quest counts, and display order.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const d = await bridgeFetch<{ count: number; questlines: { id: number; name: string; description: string; quest_count: number; order: number }[] }>("/questlines");
    const lines = d.questlines.map(l => `[${l.id}] ${l.name} (${l.quest_count} quests, order=${l.order})`);
    return text(`${d.count} questlines:\n${lines.join("\n")}`);
  } catch (e) { return err(e); }
});

// ===== bq_get_questline =====
server.registerTool("bq_get_questline", {
  description: "Get quest line details: name, description, and all quest positions.",
  inputSchema: z.object({ line_id: z.number().int().describe("Quest line ID") }),
}, async (args) => {
  try {
    const d = await bridgeFetch<{ id: number; name: string; description: string; order: number; quests: { quest_id: number; pos_x: number; pos_y: number }[] }>(`/questlines/${args.line_id}`);
    const quests = d.quests.map(q => `  [${q.quest_id}] pos=(${q.pos_x},${q.pos_y})`);
    return text(`${d.name} (id=${d.id}, order=${d.order})\n${d.description}\n\n${d.quests.length} quests:\n${quests.join("\n")}`);
  } catch (e) { return err(e); }
});

// ===== bq_get_quest =====
server.registerTool("bq_get_quest", {
  description: "Get full quest details: name, description, icon, properties, prerequisites, tasks, rewards, and which quest lines it's in.",
  inputSchema: z.object({ quest_id: z.number().int().describe("Quest ID") }),
}, async (args) => {
  try {
    const d = await bridgeFetch<Record<string, unknown>>(`/quests/${args.quest_id}`);
    const lines: string[] = [];
    lines.push(`Quest [${d.id}] ${d.name}`);
    lines.push(`Icon: ${d.icon}`);
    lines.push(`Visibility: ${d.visibility} | Frame: ${d.frame}`);
    lines.push(`Logic: quest=${d.logic_quest} task=${d.logic_task}`);
    if (d.repeat_time !== -1) lines.push(`Repeat: ${d.repeat_time}`);
    if (d.locked_progress) lines.push("Locked Progress: ON");
    if (d.auto_claim) lines.push("Auto Claim: ON");
    if (d.simultaneous) lines.push("Simultaneous: ON");
    if (d.global_share) lines.push("Global Share: ON");
    lines.push("");
    lines.push("Description:");
    lines.push(String(d.description));
    const prereqs = d.prerequisites as { id: number; type: string }[];
    if (prereqs.length > 0) {
      lines.push("");
      lines.push(`Prerequisites (${prereqs.length}):`);
      prereqs.forEach(p => lines.push(`  [${p.id}] ${p.type}`));
    } else {
      lines.push("\nPrerequisites: none (root quest)");
    }
    const tasks = d.tasks as { id: number; type: string; name: string }[];
    if (tasks.length > 0) {
      lines.push("");
      lines.push(`Tasks (${tasks.length}):`);
      tasks.forEach(t => lines.push(`  ${t.type}: ${t.name}`));
    }
    const rewards = d.rewards as { id: number; type: string; name: string }[];
    if (rewards.length > 0) {
      lines.push("");
      lines.push(`Rewards (${rewards.length}):`);
      rewards.forEach(r => lines.push(`  ${r.type}: ${r.name}`));
    }
    const inLines = d.in_questlines as { line_id: number; line_name: string; pos_x: number; pos_y: number }[];
    if (inLines.length > 0) {
      lines.push("");
      lines.push("In questlines:");
      inLines.forEach(l => lines.push(`  [${l.line_id}] ${l.line_name} at (${l.pos_x},${l.pos_y})`));
    }
    return text(lines.join("\n"));
  } catch (e) { return err(e); }
});

// ===== bq_search_quests =====
server.registerTool("bq_search_quests", {
  description: "Search quests by name or description (case-insensitive substring match).",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search term"),
    limit: z.number().int().min(1).max(500).default(50).describe("Max results"),
  }),
}, async (args) => {
  try {
    const q = encodeURIComponent(args.query);
    const d = await bridgeFetch<{ total: number; results: { id: number; name: string; description: string }[] }>(`/quests?q=${q}&limit=${args.limit}`);
    if (d.results.length === 0) return text(`No quests matching "${args.query}"`);
    const results = d.results.map(r => {
      const desc = r.description.length > 80 ? r.description.substring(0, 80) + "..." : r.description;
      return `[${r.id}] ${r.name} — ${desc}`;
    });
    return text(`Found ${d.total} quests (showing ${d.results.length}):\n${results.join("\n")}`);
  } catch (e) { return err(e); }
});

// ===== bq_validate =====
server.registerTool("bq_validate", {
  description: "Validate quest structure: broken prerequisites, missing tasks, position overlaps, missing quest references.",
  inputSchema: z.object({
    line_id: z.number().int().min(0).optional().describe("Quest line ID (omit to validate all)"),
  }),
}, async (args) => {
  try {
    const param = args.line_id != null ? `?line_id=${args.line_id}` : "";
    const d = await bridgeFetch<{ status: string; issue_count: number; issues: { severity: string; quest_id: number; quest_name?: string; questline?: string; message: string; overlapping_quest_id?: number; position?: string }[] }>(`/validate${param}`);
    if (d.issue_count === 0) return text("Validation passed — 0 issues found.");
    const lines: string[] = [`Found ${d.issue_count} issues:\n`];
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BQ MCP Server connected via stdio");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
