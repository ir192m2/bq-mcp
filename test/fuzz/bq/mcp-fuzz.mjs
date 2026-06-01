#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FuzzReport, FUZZ_INPUTS, bridgeUp, COLORS, PORT } from '../shared/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = new FuzzReport('BQ MCP Server Fuzzer');

const SERVER = 'node';
const ARGS = [resolve(__dirname, '../../../server/dist/index.js')];

const bqUp = await bridgeUp(PORT.BQ, 2000);
console.log(`${bqUp ? COLORS.green : COLORS.yellow}BQ bridge ${bqUp ? 'up' : 'down'}. MCP server will report 'Bridge not running' for live calls.${COLORS.reset}`);

const proc = spawn(SERVER, ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
proc.stdout.on('data', d => { stdout += d.toString(); feedData(d.toString()); });
proc.stderr.on('data', d => { stderr += d.toString(); });
await new Promise(r => setTimeout(r, 500));

const respQueue = [];
let buf = '';
const respWaiters = [];
function feedData(s) {
  buf += s;
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const obj = JSON.parse(l);
      if (respWaiters.length > 0) {
        const w = respWaiters.shift();
        clearTimeout(w.to);
        w.resolve({ msg: obj, raw: l });
      } else {
        respQueue.push({ msg: obj, raw: l });
      }
    } catch {}
  }
}
function send(msg) { proc.stdin.write(JSON.stringify(msg) + '\n'); }
function nextResp(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (respQueue.length > 0) { resolve(respQueue.shift()); return; }
    const to = setTimeout(() => {
      const idx = respWaiters.findIndex(w => w.resolve === resolve);
      if (idx >= 0) respWaiters.splice(idx, 1);
      resolve({ error: 'timeout', raw: buf });
    }, timeoutMs);
    respWaiters.push({ resolve, to });
  });
}

r.section('1. Initialize / list tools');
{
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fuzz', version: '0.1' } } });
  const r1 = await nextResp();
  r.case('initialize', !!r1.msg?.result?.serverInfo, `server=${r1.msg?.result?.serverInfo?.name} ver=${r1.msg?.result?.serverInfo?.version}`, 'init');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const r2 = await nextResp();
  const tools = r2.msg?.result?.tools || [];
  r.case('tools/list returns array', Array.isArray(tools), `n=${tools.length}`, 'init');
  r.case('has 24 tools (6 read + 8 write + 10 graph)', tools.length === 24, `n=${tools.length}`, 'init');
  const names = tools.map(t => t.name).sort();
  r.case('has bq_health', names.includes('bq_health'), '', 'init');
  r.case('has bq_create_quest', names.includes('bq_create_quest'), '', 'init');
  r.case('has bq_delete_quest', names.includes('bq_delete_quest'), '', 'init');
  r.case('has bq_save_questbook', names.includes('bq_save_questbook'), '', 'init');
  r.case('has bq_graph_health', names.includes('bq_graph_health'), '', 'init');
  r.case('has bq_graph_get_dependencies', names.includes('bq_graph_get_dependencies'), '', 'init');
  r.case('has bq_graph_detect_cycles', names.includes('bq_graph_detect_cycles'), '', 'init');
}

r.section('2. Tool: bq_health');
{
  for (const args of [{}, { extra: 'field' }, null, { detail: true }]) {
    send({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'bq_health', arguments: args } });
    const r1 = await nextResp();
    const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
    const isBridgeNotRunning = r1.msg?.result?.content?.[0]?.text?.includes('Bridge not running');
    const text = r1.msg?.result?.content?.[0]?.text || r1.msg?.error?.message || '';
    r.case(`args=${JSON.stringify(args).slice(0,40)}`, hasResponse, `bridgeUp=${bqUp} text=${text.slice(0,80)}`, 'tool-bq_health');
  }
}

r.section('3. Tool: bq_list_questlines / bq_get_questline / bq_get_quest / bq_search_quests / bq_validate');
{
  for (const [tool, args] of [
    ['bq_list_questlines', {}],
    ['bq_list_questlines', null],
    ['bq_list_questlines', { extra: 'field' }],
    ['bq_get_questline', { line_id: 1 }],
    ['bq_get_questline', { line_id: 0 }],
    ['bq_get_questline', { line_id: -1 }],
    ['bq_get_questline', { line_id: 'abc' }],
    ['bq_get_questline', { line_id: 99999999 }],
    ['bq_get_questline', { line_id: 1.5 }],
    ['bq_get_questline', {}],
    ['bq_get_questline', { line_id: null }],
    ['bq_get_quest', { quest_id: 1 }],
    ['bq_get_quest', { quest_id: 0 }],
    ['bq_get_quest', { quest_id: -1 }],
    ['bq_get_quest', { quest_id: 'abc' }],
    ['bq_get_quest', {}],
    ['bq_search_quests', { query: 'iron' }],
    ['bq_search_quests', { query: 'NONEXISTENT' }],
    ['bq_search_quests', { query: '' }],
    ['bq_search_quests', { query: FUZZ_INPUTS.sqlInject }],
    ['bq_search_quests', { query: FUZZ_INPUTS.xss }],
    ['bq_search_quests', { query: FUZZ_INPUTS.unicode }],
    ['bq_search_quests', { query: FUZZ_INPUTS.nullByte }],
    ['bq_search_quests', { query: 'iron', limit: -1 }],
    ['bq_search_quests', { query: 'iron', limit: 99999 }],
    ['bq_search_quests', { query: 'iron', limit: 'abc' }],
    ['bq_search_quests', {}],
    ['bq_validate', {}],
    ['bq_validate', null],
  ]) {
    send({ jsonrpc: '2.0', id: 200, method: 'tools/call', params: { name: tool, arguments: args } });
    const r1 = await nextResp();
    const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
    r.case(`${tool} ${JSON.stringify(args).slice(0,40)}`, hasResponse, `text=${(r1.msg?.result?.content?.[0]?.text || r1.msg?.error?.message || '').slice(0,80)}`, `tool-${tool}`);
  }
}

r.section('4. Write tools — dry-run default');
{
  for (const [tool, args] of [
    ['bq_create_quest', { quest_id: 999999, name: 'fuzz test' }],
    ['bq_create_quest', {}],
    ['bq_create_quest', { quest_id: -1 }],
    ['bq_create_quest', { quest_id: 1, name: null }],
    ['bq_create_quest', { quest_id: 1, name: FUZZ_INPUTS.xss }],
    ['bq_create_quest', { quest_id: 1, prerequisites: 'not_array' }],
    ['bq_create_quest', { quest_id: 1, prerequisites: [{ id: 'string' }] }],
    ['bq_update_quest', { quest_id: 1, name: 'updated' }],
    ['bq_update_quest', { quest_id: -1, name: 'x' }],
    ['bq_update_quest', {}],
    ['bq_update_quest', { quest_id: 1, name: null }],
    ['bq_delete_quest', { quest_id: 999999 }],
    ['bq_delete_quest', {}],
    ['bq_delete_quest', { quest_id: -1 }],
    ['bq_delete_quest', { quest_id: 1, commit: true }],
    ['bq_delete_quest', { quest_id: 1, commit: 'yes' }],
    ['bq_move_quest', { quest_id: 1, line_id: 1, x: 0, y: 0 }],
    ['bq_move_quest', { quest_id: -1, line_id: 1, x: 0, y: 0 }],
    ['bq_move_quest', { quest_id: 1, line_id: 1, x: 'bad', y: 0 }],
    ['bq_move_quest', {}],
    ['bq_set_prerequisites', { quest_id: 1, prerequisites: [{ id: 2, required: true }] }],
    ['bq_set_prerequisites', { quest_id: 1, prerequisites: [] }],
    ['bq_set_prerequisites', { quest_id: 1, prerequisites: 'bad' }],
    ['bq_set_prerequisites', {}],
    ['bq_reorder_questline', { line_id: 1, order: 5 }],
    ['bq_reorder_questline', { line_id: -1, order: 5 }],
    ['bq_reorder_questline', { line_id: 1, order: -1 }],
    ['bq_reorder_questline', { line_id: 1, order: 1.5 }],
    ['bq_reorder_questline', {}],
    ['bq_create_questline', { line_id: 1, name: 'test' }],
    ['bq_create_questline', {}],
    ['bq_create_questline', { line_id: -1 }],
    ['bq_create_questline', { line_id: 1, name: null }],
  ]) {
    send({ jsonrpc: '2.0', id: 300, method: 'tools/call', params: { name: tool, arguments: args } });
    const r1 = await nextResp();
    const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
    const isDryRun = !bqUp ? r1.msg?.result?.content?.[0]?.text?.includes('Bridge not running') : r1.msg?.result?.content?.[0]?.text?.match(/dry.?run/i);
    r.case(`${tool} ${JSON.stringify(args).slice(0,40)}`, hasResponse, `dry_run_detected=${!!isDryRun}`, `write-${tool}`);
  }
}

r.section('5. bq_save_questbook');
{
  for (const args of [{}, { force: true }, { force: 'yes' }, { force: null }, null]) {
    send({ jsonrpc: '2.0', id: 400, method: 'tools/call', params: { name: 'bq_save_questbook', arguments: args } });
    const r1 = await nextResp();
    const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
    r.case(`args=${JSON.stringify(args).slice(0,40)}`, hasResponse, `text=${(r1.msg?.result?.content?.[0]?.text || r1.msg?.error?.message || '').slice(0,80)}`, 'tool-bq_save_questbook');
  }
}

r.section('6. Unknown tool names');
{
  for (const name of ['nonexistent', 'bq_', 'delete_questbook', '', null, 123, '../etc/passwd', 'bq_delete_quest;DROP']) {
    send({ jsonrpc: '2.0', id: 500, method: 'tools/call', params: { name, arguments: {} } });
    const r1 = await nextResp();
    const isError = !!r1.msg?.error || r1.msg?.result?.isError === true;
    r.case(`name=${JSON.stringify(name).slice(0,40)}`, isError, `error=${(r1.msg?.error?.message || r1.msg?.result?.content?.[0]?.text || '').slice(0,80)}`, 'unknown');
  }
}

r.section('7. JSON-RPC protocol abuse');
{
  for (const msg of [
    { jsonrpc: '2.0', id: 600, method: 'tools/call', params: { name: 'bq_health', arguments: {} } },
    { jsonrpc: '2.0', id: 601, method: 'tools/call' },
    { jsonrpc: '2.0', id: 602, method: 'unknown/method' },
    { jsonrpc: '2.0', id: 603, method: '' },
    { jsonrpc: '1.0', id: 604, method: 'tools/list' },
    { id: 605, method: 'tools/list' },
    { jsonrpc: '2.0', id: 'string-id', method: 'tools/list' },
  ]) {
    send(msg);
    const r1 = await nextResp(3000);
    const hasResponse = !!r1.msg || !!r1.error;
    r.case(`msg=${JSON.stringify(msg).slice(0,60)}`, hasResponse, `err=${r1.error || 'none'} resp=${!!r1.msg?.result}`, 'rpc');
  }
}

r.section('8. Large payload');
{
  send({ jsonrpc: '2.0', id: 700, method: 'tools/call', params: { name: 'bq_create_quest', arguments: { quest_id: 1, name: 'A'.repeat(500_000) } } });
  const r1 = await nextResp(10_000);
  const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
  r.case('500KB name', hasResponse, `text=${(r1.msg?.result?.content?.[0]?.text || r1.msg?.error?.message || '').slice(0,80)}`, 'large');
}

r.section('9. Concurrency');
{
  const calls = Array(20).fill(0).map((_, i) => ({ jsonrpc: '2.0', id: 800 + i, method: 'tools/call', params: { name: 'bq_health', arguments: {} } }));
  for (const c of calls) send(c);
  const responses = [];
  for (let i = 0; i < calls.length; i++) {
    const resp = await nextResp(5000);
    responses.push(resp);
  }
  const allOk = responses.every(r => r.msg?.result?.content || r.msg?.error);
  r.case('20 concurrent bq_health', allOk, `${allOk ? 'all OK' : 'some failed'}`, 'concurrent');
}

r.section('10. Bridge-down safety message');
{
  if (!bqUp) {
    const tools = ['bq_health', 'bq_list_questlines', 'bq_get_questline', 'bq_get_quest', 'bq_search_quests', 'bq_validate'];
    for (const tool of tools) {
      send({ jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name: tool, arguments: tool === 'bq_health' ? {} : { quest_id: 1, line_id: 1, query: 'x' } } });
      const r1 = await nextResp();
      const hasBridgeMsg = r1.msg?.result?.content?.[0]?.text?.includes('Bridge not running');
      r.case(`${tool} reports bridge not running`, hasBridgeMsg, `text=${(r1.msg?.result?.content?.[0]?.text || '').slice(0,80)}`, 'graceful-degraded');
    }
  } else {
    r.case('skipped (bridge up)', true);
  }
}

proc.stdin.end();
proc.kill('SIGTERM');
r.print();
process.exit(r.failures.length > 0 ? 1 : 0);
