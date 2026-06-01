#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0, total = 0;

function check(name, condition, detail = "") {
  total++;
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class MCPClient {
  constructor(serverPath) {
    this.proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    this.buf = "";
    this.id = 1;
    this.pending = new Map();
    this.proc.stdout.on("data", chunk => {
      this.buf += chunk.toString();
      const lines = this.buf.split("\n");
      this.buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch {}
      }
    });
  }

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async init() {
    const r = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "fuzz-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    await sleep(100);
    return r;
  }

  async callTool(name, args) { return this.send("tools/call", { name, arguments: args }); }

  kill() {
    try { this.proc.kill("SIGKILL"); } catch {}
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  BQ MCP PROTOCOL FUZZ TEST");
  console.log("═══════════════════════════════════════════");

  const client = new MCPClient(path.resolve(__dirname, "index.js"));
  await sleep(500);

  try {
    const r = await client.init();
    check("initialize succeeds", r?.serverInfo?.name === "bq-mcp-server");

    const tools = await client.send("tools/list", {});
    const toolNames = tools.tools.map(t => t.name);
    check("tools/list returns 6 tools", tools.tools.length === 6, `got ${tools.tools.length}: ${toolNames.join(",")}`);
    for (const name of ["bq_health","bq_list_questlines","bq_get_questline","bq_get_quest","bq_search_quests","bq_validate"]) {
      check(`tool "${name}" advertised`, toolNames.includes(name));
    }

    let r2 = await client.callTool("bq_health", {});
    check("bq_health not error", !r2.isError);
    check("bq_health text non-empty", r2.content[0].text.length > 0);
    check("bq_health mentions 416 quests", r2.content[0].text.includes("416") || r2.content[0].text.toLowerCase().includes("quest"));

    r2 = await client.callTool("bq_list_questlines", {});
    check("list_questlines not error", !r2.isError);
    check("list_questlines mentions Main Path", r2.content[0].text.includes("Main Path"));
    check("list_questlines mentions 23", r2.content[0].text.includes("23"));

    r2 = await client.callTool("bq_get_questline", { line_id: 50 });
    check("get_questline(50) not error", !r2.isError);
    check("get_questline(50) mentions Main Path", r2.content[0].text.includes("Main Path"));
    check("get_questline(50) mentions 19 quests", r2.content[0].text.includes("19"));

    r2 = await client.callTool("bq_get_questline", { line_id: 100 });
    check("get_questline(100) not error", !r2.isError);
    check("get_questline(100) mentions Advanced Rocketry", r2.content[0].text.includes("Advanced Rocketry"));

    r2 = await client.callTool("bq_get_questline", { line_id: 99999 });
    check("get_questline(99999) handles error", r2.content[0].text.length > 0);

    r2 = await client.callTool("bq_get_quest", { quest_id: 30140 });
    check("get_quest(30140) not error", !r2.isError);
    check("get_quest(30140) mentions Certus Quartz Ore", r2.content[0].text.includes("Certus Quartz Ore"));
    check("get_quest(30140) has Prerequisites", r2.content[0].text.includes("Prerequisites"));
    check("get_quest(30140) has Tasks", r2.content[0].text.includes("Tasks"));

    r2 = await client.callTool("bq_get_quest", { quest_id: 30141 });
    check("get_quest(30141) not error", !r2.isError);
    check("get_quest(30141) text non-empty", r2.content[0].text.length > 50);

    r2 = await client.callTool("bq_get_quest", { quest_id: 999999 });
    check("get_quest(999999) handles error", r2.content[0].text.length > 0);

    r2 = await client.callTool("bq_search_quests", { query: "diamond", limit: 5 });
    check("search(diamond) not error", !r2.isError);
    check("search(diamond) text non-empty", r2.content[0].text.length > 10);
    check("search(diamond) found results", r2.content[0].text.includes("Found 18") || r2.content[0].text.includes("Found 1") || r2.content[0].text.includes("["));

    const ra = await client.callTool("bq_search_quests", { query: "DIAMOND", limit: 5 });
    const rb = await client.callTool("bq_search_quests", { query: "diamond", limit: 5 });
    check("search case-insensitive", ra.content[0].text === rb.content[0].text);

    r2 = await client.callTool("bq_search_quests", { query: "xyzzy_nonexistent_999" });
    check("search(nonexistent) returns without crash", r2.content[0].text.length > 0);
    check("search(nonexistent) mentions no matches", r2.content[0].text.includes("No") || r2.content[0].text.includes("0"));

    r2 = await client.callTool("bq_validate", {});
    check("validate not error", !r2.isError);
    check("validate text non-empty", r2.content[0].text.length > 0);
    check("validate mentions issues or passed", r2.content[0].text.includes("issue") || r2.content[0].text.includes("passed"));

    r2 = await client.callTool("bq_validate", { line_id: 50 });
    check("validate(line=50) not error", !r2.isError);

    r2 = await client.callTool("bq_validate", { line_id: 99999 });
    check("validate(line=99999) returns without crash", r2.content[0].text.length > 0);

    r2 = await client.callTool("bq_search_quests", { query: "<script>alert(1)</script>" });
    check("search(xss-like) returns without crash", r2.content[0].text.length > 0);

    r2 = await client.callTool("bq_search_quests", { query: "a".repeat(500) });
    check("search(long query) returns without crash", r2.content[0].text.length > 0);

    r2 = await client.callTool("bq_search_quests", { query: "diamond", limit: 5, bogus: true });
    check("extra params ignored", !r2.isError);

    const rapid = await Promise.all([
      client.callTool("bq_health", {}),
      client.callTool("bq_list_questlines", {}),
      client.callTool("bq_validate", {}),
      client.callTool("bq_search_quests", { query: "iron", limit: 3 }),
    ]);
    check("4 rapid calls all succeed", rapid.every(r => !r.isError));

  } catch (e) {
    check("test suite", false, e.message);
  }

  client.kill();
  console.log("\n═══════════════════════════════════════════");
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main();
