#!/usr/bin/env node

const BASE = "http://127.0.0.1:18733/api";
let passed = 0, failed = 0, total = 0;

async function req(path, method = "GET") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(`${BASE}${path}`, { method, signal: controller.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: resp.status, json, text, ok: resp.ok };
  } finally { clearTimeout(timeout); }
}

function check(name, condition, detail = "") {
  total++;
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

function checkError(name, result, expectedStatus) {
  check(`${name} returns ${expectedStatus}`, result.status === expectedStatus, `got ${result.status}`);
}

// ─────────────────────────────────────────────
// 1. HEALTH
// ─────────────────────────────────────────────
async function testHealth() {
  console.log("\n[1] HEALTH");
  const r = await req("/health");
  check("status 200", r.status === 200);
  check("status=ok", r.json?.status === "ok");
  check("quest_count present and number", typeof r.json?.quest_count === "number" && r.json.quest_count > 0, `got ${r.json?.quest_count}`);
  check("questline_count present and number", typeof r.json?.questline_count === "number" && r.json.questline_count > 0, `got ${r.json?.questline_count}`);
  check("player present", typeof r.json?.player === "string" && r.json.player.length > 0);
}

// ─────────────────────────────────────────────
// 2. QUESTLINES
// ─────────────────────────────────────────────
async function testQuestlines() {
  console.log("\n[2] QUESTLINES");
  const r = await req("/questlines");
  check("status 200", r.status === 200);
  check("count field present", typeof r.json?.count === "number");
  check("questlines array present", Array.isArray(r.json?.questlines));
  check("count matches array length", r.json?.count === r.json?.questlines?.length);

  const ql = r.json.questlines;
  check("at least 20 questlines", ql.length >= 20, `got ${ql.length}`);
  check("each has id", ql.every(q => typeof q.id === "number"));
  check("each has name", ql.every(q => typeof q.name === "string" && q.name.length > 0));
  check("each has quest_count", ql.every(q => typeof q.quest_count === "number"));
  check("each has order", ql.every(q => typeof q.order === "number"));
  check("each has description", ql.every(q => typeof q.description === "string"));

  // Known questlines exist
  const ids = ql.map(q => q.id);
  check("Main Path (id=50) exists", ids.includes(50));
  check("Advanced Rocketry (id=100) exists", ids.includes(100));
  check("Thermal Foundation (id=300) exists", ids.includes(300));
}

// ─────────────────────────────────────────────
// 3. QUESTLINE DETAIL
// ─────────────────────────────────────────────
async function testQuestlineDetail() {
  console.log("\n[3] QUESTLINE DETAIL");
  let r = await req("/questlines/50");
  check("questline 50 returns 200", r.status === 200);
  check("name=Main Path", r.json?.name === "Main Path");
  check("id=50", r.json?.id === 50);
  check("description present", typeof r.json?.description === "string" && r.json.description.length > 10);
  check("quests array present", Array.isArray(r.json?.quests));
  check("Main Path has 19 quests", r.json?.quests?.length === 19, `got ${r.json?.quests?.length}`);
  check("quest has quest_id", r.json?.quests[0]?.quest_id !== undefined);
  check("quest has pos_x", typeof r.json?.quests[0]?.pos_x === "number");
  check("quest has pos_y", typeof r.json?.quests[0]?.pos_y === "number");

  // Different questline
  r = await req("/questlines/100");
  check("questline 100 (Adv Rocketry) returns 200", r.status === 200);
  check("Adv Rocketry name correct", r.json?.name === "Advanced Rocketry");
  check("Adv Rocketry has 93 quests", r.json?.quests?.length === 93, `got ${r.json?.quests?.length}`);

  // Non-existent questline
  r = await req("/questlines/99999");
  checkError("non-existent questline", r, 404);

  // Invalid questline
  r = await req("/questlines/abc");
  check("non-numeric questline returns 400", r.status === 400);

  r = await req("/questlines/-1");
  checkError("negative questline id", r, 404);
}

// ─────────────────────────────────────────────
// 4. QUEST DETAIL
// ─────────────────────────────────────────────
async function testQuestDetail() {
  console.log("\n[4] QUEST DETAIL");

  // Known root quest
  let r = await req("/quests/30140");
  check("quest 30140 returns 200", r.status === 200);
  check("name present", r.json?.name === "Certus Quartz Ore");
  check("id=30140", r.json?.id === 30140);
  check("description present", typeof r.json?.description === "string" && r.json.description.length > 0);
  check("icon present", typeof r.json?.icon === "string");
  check("visibility present", typeof r.json?.visibility === "string");
  check("frame present", typeof r.json?.frame === "string");
  check("logic_quest present", typeof r.json?.logic_quest === "string");
  check("logic_task present", typeof r.json?.logic_task === "string");
  check("tasks array present", Array.isArray(r.json?.tasks));
  check("tasks non-empty", r.json?.tasks?.length > 0);
  check("rewards array present", Array.isArray(r.json?.rewards));
  check("prerequisites array present", Array.isArray(r.json?.prerequisites));
  check("in_questlines array present", Array.isArray(r.json?.in_questlines));
  check("in_questlines has line_name", r.json?.in_questlines[0]?.line_name === "Applied Energistics 2");

  // Quest with prerequisites
  r = await req("/quests/30141");
  check("quest 30141 returns 200", r.status === 200);
  if (r.json?.prerequisites?.length > 0) {
    check("prereq has id", typeof r.json.prerequisites[0].id === "number");
    check("prereq has type", typeof r.json.prerequisites[0].type === "string");
  }

  // Non-existent quest
  r = await req("/quests/999999");
  checkError("non-existent quest", r, 404);

  // Invalid quest
  r = await req("/quests/abc");
  check("non-numeric quest returns 400", r.status === 400);

  r = await req("/quests/-1");
  checkError("negative quest id", r, 404);
}

// ─────────────────────────────────────────────
// 5. SEARCH
// ─────────────────────────────────────────────
async function testSearch() {
  console.log("\n[5] SEARCH");

  let r = await req("/quests?q=diamond");
  check("'diamond' search returns 200", r.status === 200);
  check("total field present", typeof r.json?.total === "number");
  check("results array present", Array.isArray(r.json?.results));
  check("'diamond' has matches", r.json?.total > 0);
  check("result has id", r.json?.results[0]?.id !== undefined);
  check("result has name", r.json?.results[0]?.name !== undefined);
  check("result has description", r.json?.results[0]?.description !== undefined);

  // Case insensitive
  const r1 = await req("/quests?q=DIAMOND");
  const r2 = await req("/quests?q=diamond");
  check("search is case-insensitive", r1.json?.total === r2.json?.total);

  // Partial match
  r = await req("/quests?q=quartz");
  check("'quartz' has matches", r.json?.total > 0);

  // Limit
  r = await req("/quests?q=diamond&limit=2");
  check("limit=2 returns at most 2", r.json?.results?.length <= 2);

  // No results
  r = await req("/quests?q=xyzzy_nothing_9999");
  check("no-match returns empty", r.json?.results?.length === 0);
  check("no-match total=0", r.json?.total === 0);

  // Empty query — server returns 400
  r = await req("/quests?q=");
  check("empty query returns 400", r.status === 400);
}

// ─────────────────────────────────────────────
// 6. VALIDATE
// ─────────────────────────────────────────────
async function testValidate() {
  console.log("\n[6] VALIDATE");

  let r = await req("/validate");
  check("validate returns 200", r.status === 200);
  check("issue_count present", typeof r.json?.issue_count === "number");
  check("issues array present", Array.isArray(r.json?.issues));

  if (r.json.issue_count > 0) {
    const issue = r.json.issues[0];
    check("issue has severity", typeof issue.severity === "string");
    check("issue has message", typeof issue.message === "string");
    check("issue has quest_id", typeof issue.quest_id === "number");
    check("severity is WARN or CRITICAL", ["WARN", "CRITICAL"].includes(issue.severity));
  }

  // Validate specific questline
  r = await req("/validate?line_id=50");
  check("validate line_id=50 returns 200", r.status === 200);
  check("line_id=50 has issue_count", typeof r.json?.issue_count === "number");

  // Non-existent questline
  r = await req("/validate?line_id=99999");
  check("validate non-existent line returns 200 or 404", r.status === 200 || r.status === 404);
}

// ─────────────────────────────────────────────
// 7. EDGE CASES / FUZZING
// ─────────────────────────────────────────────
async function testEdgeCases() {
  console.log("\n[7] EDGE CASES");

  // Special characters — encoded & causes query splitting
  let r = await req("/quests?q=%26%3C%3E%22%27%25");
  check("special chars search handled (200 or 400)", r.status === 200 || r.status === 400);

  // Unicode
  r = await req("/quests?q=%E4%B8%AD%E6%96%87");
  check("unicode search handled", r.status === 200);

  // Very long query
  r = await req(`/quests?q=${"a".repeat(500)}`);
  check("very long query handled", r.status === 200);

  // SQL injection
  r = await req("/quests?q=%27%20OR%201%3D1%20--");
  check("SQL injection handled", r.status === 200);

  // XSS
  r = await req("/quests?q=%3Cscript%3Ealert(1)%3C/script%3E");
  check("XSS-like handled", r.status === 200);

  // Null bytes
  r = await req("/quests?q=test%00null");
  check("null byte handled", r.status === 200);

  // Path traversal
  r = await req("/questlines/..%2F..%2Fetc%2Fpasswd");
  check("path traversal blocked", r.status !== 200 || r.json?.error !== undefined);

  // Large questline id
  r = await req("/questlines/999999999");
  check("huge questline id handled", r.status === 200 || r.status === 404);

  // Large quest id
  r = await req("/quests/999999999");
  check("huge quest id handled", r.status === 200 || r.status === 404);

  // Negative ids
  r = await req("/questlines/-999");
  check("negative questline id", r.status === 200 || r.status === 404);

  r = await req("/quests/-999");
  check("negative quest id", r.status === 200 || r.status === 404);
}

// ─────────────────────────────────────────────
// 8. HTTP METHODS
// ─────────────────────────────────────────────
async function testHttpMethods() {
  console.log("\n[8] HTTP METHODS");

  let r;
  r = await req("/health", "POST");
  check("POST /health rejected", r.status === 405 || r.status === 404);

  r = await req("/questlines", "POST");
  check("POST /questlines rejected", r.status === 405 || r.status === 404);

  r = await req("/health", "PUT");
  check("PUT /health rejected", r.status === 405 || r.status === 404);

  r = await req("/health", "DELETE");
  check("DELETE /health rejected", r.status === 405 || r.status === 404);
}

// ─────────────────────────────────────────────
// 9. PERFORMANCE / STRESS
// ─────────────────────────────────────────────
async function testPerformance() {
  console.log("\n[9] PERFORMANCE / STRESS");

  // Rapid fire 10 searches
  const start = Date.now();
  const promises = Array.from({ length: 10 }, (_, i) =>
    req(`/quests?q=${["diamond","iron","redstone","coal","gold"][i%5]}&limit=5`)
  );
  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;
  check("10 parallel searches complete", results.every(r => r.status === 200));
  check(`10 parallel searches under 30s`, elapsed < 30000, `${elapsed}ms`);

  // Concurrent different endpoints
  const mixed = await Promise.all([
    req("/health"),
    req("/questlines"),
    req("/questlines/50"),
    req("/quests/30140"),
    req("/validate"),
  ]);
  check("5 concurrent mixed endpoints all succeed", mixed.every(r => r.status === 200));
}

// ─────────────────────────────────────────────
// 10. DATA CONSISTENCY
// ─────────────────────────────────────────────
async function testDataConsistency() {
  console.log("\n[10] DATA CONSISTENCY");

  // Health counts match
  const h = await req("/health");
  const ql = await req("/questlines");
  check("health.questline_count == questlines.count", h.json?.questline_count === ql.json?.count);

  // Sum of questline quest_counts matches total
  const sum = ql.json.questlines.reduce((a, q) => a + q.quest_count, 0);
  check(`sum of questline quest_counts ≈ health.quest_count`, Math.abs(sum - h.json?.quest_count) < 20,
    `sum=${sum} health=${h.json?.quest_count}`);

  // Quest in questline detail matches quest detail
  const line = await req("/questlines/50");
  if (line.json?.quests?.length > 0) {
    const firstQuestId = line.json.quests[0].quest_id;
    const quest = await req(`/quests/${firstQuestId}`);
    check(`quest [${firstQuestId}] detail returns 200`, quest.status === 200);
    check(`quest [${firstQuestId}] is in questline 50`,
      quest.json?.in_questlines?.some(l => l.line_id === 50));
  }

  // Search result quests are valid
  const search = await req("/quests?q=AE2&limit=3");
  if (search.json?.results?.length > 0) {
    const qid = search.json.results[0].id;
    const detail = await req(`/quests/${qid}`);
    check(`search result [${qid}] detail returns 200`, detail.status === 200);
    check(`search result [${qid}] name matches`, detail.json?.name === search.json.results[0].name);
  }
}

// ─────────────────────────────────────────────
// RUN ALL
// ─────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  BQ MCP FUZZ TEST");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════");

  try { await testHealth(); } catch (e) { failed++; console.log(`  ✗ Health threw: ${e.message}`); }
  try { await testQuestlines(); } catch (e) { failed++; console.log(`  ✗ Questlines threw: ${e.message}`); }
  try { await testQuestlineDetail(); } catch (e) { failed++; console.log(`  ✗ QuestlineDetail threw: ${e.message}`); }
  try { await testQuestDetail(); } catch (e) { failed++; console.log(`  ✗ QuestDetail threw: ${e.message}`); }
  try { await testSearch(); } catch (e) { failed++; console.log(`  ✗ Search threw: ${e.message}`); }
  try { await testValidate(); } catch (e) { failed++; console.log(`  ✗ Validate threw: ${e.message}`); }
  try { await testEdgeCases(); } catch (e) { failed++; console.log(`  ✗ EdgeCases threw: ${e.message}`); }
  try { await testHttpMethods(); } catch (e) { failed++; console.log(`  ✗ HttpMethods threw: ${e.message}`); }
  try { await testPerformance(); } catch (e) { failed++; console.log(`  ✗ Performance threw: ${e.message}`); }
  try { await testDataConsistency(); } catch (e) { failed++; console.log(`  ✗ DataConsistency threw: ${e.message}`); }

  console.log("\n═══════════════════════════════════════════");
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main();
