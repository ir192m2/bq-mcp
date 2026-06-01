#!/usr/bin/env node
import { FuzzReport, httpReq, FUZZ_INPUTS, PORT, bridgeUp, COLORS } from '../shared/harness.mjs';

const r = new FuzzReport('BQ HTTP Bridge Fuzzer');

const isUp = await bridgeUp(PORT.BQ, 2000);
if (!isUp) {
  console.log(`${COLORS.yellow}BQ bridge NOT up on :${PORT.BQ} (no world loaded).${COLORS.reset}`);
  console.log(`${COLORS.yellow}Will verify graceful-degradation behavior across all endpoints.${COLORS.reset}`);
  console.log(`${COLORS.yellow}For full coverage, load a singleplayer world.${COLORS.reset}`);
}

r.section('1. Bridge availability');
{
  if (isUp) {
    r.pass('BQ bridge reachable on :18733');
    const resp = await httpReq(PORT.BQ, '/api/health');
    r.pass('GET /api/health', resp.status === 200, `status=${resp.status}`, 'health');
    r.pass('health.quest_count is number', typeof resp.body?.quest_count === 'number', `count=${resp.body?.quest_count}`);
    r.pass('health.questline_count is number', typeof resp.body?.questline_count === 'number', `count=${resp.body?.questline_count}`);
  } else {
    const resp = await httpReq(PORT.BQ, '/api/health', { timeout: 2000 });
    r.pass('graceful connection refused', resp.status === 0 && resp.error?.includes('refused') || resp.status === 0, `status=${resp.status} err=${resp.error}`, 'degraded');
  }
}

r.section('2. GET /api/questlines');
{
  if (!isUp) {
    r.pass('skipped (bridge not up)', 'graceful');
  } else {
    const resp = await httpReq(PORT.BQ, '/api/questlines');
    r.case('200 + array', resp.status === 200 && Array.isArray(resp.body?.questlines), `status=${resp.status} n=${resp.body?.questlines?.length}`, 'read');
  }
}

r.section('3. GET /api/questlines/{id} — boundary');
{
  for (const id of [0, 1, -1, 999999, Number.MAX_SAFE_INTEGER, 'abc', '', 'null', '../etc/passwd', '1; DROP TABLE', String(Number.MAX_SAFE_INTEGER + 1)]) {
    const resp = await httpReq(PORT.BQ, `/api/questlines/${id}`);
    const ok = isUp ? (resp.status === 200 || resp.status === 400 || resp.status === 404) : resp.status === 0;
    r.case(`id=${id}`, ok, `status=${resp.status} err=${resp.error?.slice(0,60) || ''}`, 'boundary');
  }
}

r.section('4. GET /api/quests/{id} — boundary');
{
  for (const id of [0, 1, -1, 999999, 'abc', '', 'null', '../etc/passwd', '1;DROP', '0xdeadbeef', 1e10, 1.5]) {
    const resp = await httpReq(PORT.BQ, `/api/quests/${id}`);
    const ok = isUp ? (resp.status === 200 || resp.status === 400 || resp.status === 404) : resp.status === 0;
    r.case(`id=${JSON.stringify(id)}`, ok, `status=${resp.status}`, 'boundary');
  }
}

r.section('5. GET /api/quests?q= — search boundary');
{
  for (const q of ['', '   ', 'iron', 'NONEXISTENT_XYZ_123', FUZZ_INPUTS.sqlInject, FUZZ_INPUTS.xss, FUZZ_INPUTS.unicode, FUZZ_INPUTS.nullByte, FUZZ_INPUTS.crlf, FUZZ_INPUTS.veryLong, '🎮', 'a%20b%20c']) {
    const resp = await httpReq(PORT.BQ, `/api/quests?q=${encodeURIComponent(q)}&limit=5`, { timeout: 5000 });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(`q=${q.slice(0,30)}${q.length>30?'…':''}`, ok, `status=${resp.status}`, 'search');
  }
}

r.section('6. GET /api/validate');
{
  if (!isUp) { r.pass('skipped (bridge not up)'); }
  else {
    const resp = await httpReq(PORT.BQ, '/api/validate');
    r.case('200', resp.status === 200, `status=${resp.status}`);
    r.case('has issues array', Array.isArray(resp.body?.issues), `n=${resp.body?.issues?.length}`);
    r.case('has issue_count', typeof resp.body?.issue_count === 'number', `issue_count=${resp.body?.issue_count}`);
  }
}

r.section('7. POST /api/write/quests/create — validation');
{
  for (const body of [
    {},
    null,
    { quest_id: -1 },
    { quest_id: 0 },
    { quest_id: 99999999 },
    { quest_id: 'abc' },
    { quest_id: 1, commit: 'yes' },
    { quest_id: 1, commit: null },
    { quest_id: 1, commit: 1 },
    { quest_id: 1, commit: false },
    { quest_id: 1 },
    { quest_id: 1, name: null },
    { quest_id: 1, name: '' },
    { quest_id: 1, name: FUZZ_INPUTS.xss },
    { quest_id: 1, name: FUZZ_INPUTS.unicode },
    { quest_id: 1, name: FUZZ_INPUTS.nullByte },
    { quest_id: 1, prerequisites: 'not_an_array' },
    { quest_id: 1, prerequisites: [{ id: 'string' }] },
    { quest_id: 1, prerequisites: [{ id: -1 }] },
    { quest_id: 1, prerequisites: [{ id: 1, required: 'yes' }] },
    { quest_id: 1, name: 'a'.repeat(100_000) },
    { quest_id: 1, extra_field: 'evil' },
    FUZZ_INPUTS.deepJson,
    { quest_id: 1, position: 'not_object' },
    { quest_id: 1, position: { x: 'bad', y: 0 } },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body }, { timeout: 5000 });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status} body=${JSON.stringify(resp.body).slice(0,150)}`, 'write-validation');
  }
}

r.section('8. POST /api/write/quests/delete — validation');
{
  for (const body of [
    {},
    { quest_id: -1 },
    { quest_id: 0 },
    { quest_id: 99999999 },
    { quest_id: 1, commit: true },
    { quest_id: 1 },
    { quest_id: 1, confirm: 'yes' },
    { quest_id: 1, confirm: true },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/delete', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status} body=${JSON.stringify(resp.body).slice(0,150)}`, 'write-validation');
  }
}

r.section('9. POST /api/write/quests/move — validation');
{
  for (const body of [
    {},
    { quest_id: 1 },
    { quest_id: 1, line_id: 1 },
    { quest_id: -1, line_id: 1, x: 0, y: 0 },
    { quest_id: 1, line_id: -1, x: 0, y: 0 },
    { quest_id: 1, line_id: 1, x: 'bad', y: 0 },
    { quest_id: 1, line_id: 1, x: 0, y: 0 },
    { quest_id: 1, line_id: 1, x: 1e10, y: -1e10 },
    { quest_id: 1, line_id: 1, x: NaN, y: Infinity },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/move', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status} body=${JSON.stringify(resp.body).slice(0,150)}`, 'write-validation');
  }
}

r.section('10. POST /api/write/quests/prerequisites — validation');
{
  for (const body of [
    {},
    { quest_id: 1 },
    { quest_id: 1, prerequisites: [] },
    { quest_id: 1, prerequisites: null },
    { quest_id: 1, prerequisites: 'string' },
    { quest_id: 1, prerequisites: [{ id: 'string' }] },
    { quest_id: 1, prerequisites: [{ id: 1 }] },
    { quest_id: 1, prerequisites: [{ id: 1, required: 'yes' }] },
    { quest_id: 1, prerequisites: [{ id: 1, required: null }] },
    { quest_id: 1, prerequisites: [{ id: 1, required: true }] },
    { quest_id: 1, prerequisites: [{ id: -1, required: true }] },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/prerequisites', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status} body=${JSON.stringify(resp.body).slice(0,150)}`, 'write-validation');
  }
}

r.section('11. POST /api/write/quests/update — validation');
{
  for (const body of [
    {},
    { quest_id: 1 },
    { quest_id: 1, name: 'x' },
    { quest_id: 1, description: 'x' },
    { quest_id: 1, name: null },
    { quest_id: 1, name: 123 },
    { quest_id: 1, name: { evil: true } },
    { quest_id: -1, name: 'x' },
    { quest_id: 1, name: 'a'.repeat(100_000) },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/update', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status}`, 'write-validation');
  }
}

r.section('12. POST /api/write/questlines/reorder — validation');
{
  for (const body of [
    {},
    { line_id: 1 },
    { line_id: 1, order: 1 },
    { line_id: -1, order: 1 },
    { line_id: 'abc', order: 1 },
    { line_id: 1, order: -1 },
    { line_id: 1, order: 1.5 },
    { line_id: 1, order: 1e20 },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/questlines/reorder', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status}`, 'write-validation');
  }
}

r.section('13. POST /api/write/questlines/create — validation');
{
  for (const body of [
    {},
    { line_id: 1 },
    { line_id: -1 },
    { line_id: 1, name: 'x' },
    { line_id: 1, name: null },
    { line_id: 1, name: FUZZ_INPUTS.xss },
    { line_id: 1, description: 'x' },
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/questlines/create', { method: 'POST', body });
    const ok = isUp ? (resp.status === 200 || resp.status === 400) : resp.status === 0;
    r.case(JSON.stringify(body).slice(0,60), ok, `status=${resp.status}`, 'write-validation');
  }
}

r.section('14. POST /api/write/save — safety');
{
  if (!isUp) { r.pass('skipped (bridge not up)'); }
  else {
    const noBody = await httpReq(PORT.BQ, '/api/write/save', { method: 'POST' });
    r.case('no body', noBody.status === 200 || noBody.status === 400, `status=${noBody.status}`);
    const withBody = await httpReq(PORT.BQ, '/api/write/save', { method: 'POST', body: { force: true } });
    r.case('with body', withBody.status === 200, `status=${withBody.status}`);
  }
}

r.section('15. HTTP method tampering on write endpoints');
{
  for (const path of ['/api/write/quests/create', '/api/write/quests/delete', '/api/write/save']) {
    for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const resp = await httpReq(PORT.BQ, path, { method: m });
      const ok = isUp ? (resp.status === 200 || resp.status === 400 || resp.status === 405) : resp.status === 0;
      r.case(`${m} ${path}`, ok, `status=${resp.status}`, 'method');
    }
  }
}

r.section('16. Malformed JSON bodies');
{
  for (const body of [
    '{',
    '{quest_id:1',
    '[]',
    'null',
    'true',
    '123',
    '"string"',
    '{"quest_id": Infinity}',
    '{"quest_id": NaN}',
    '{"quest_id": undefined}',
    '',
    '   ',
  ]) {
    const resp = await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body });
    const ok = isUp ? (resp.status === 400 || resp.status === 200) : resp.status === 0;
    r.case(`body=${body.slice(0,30)}`, ok, `status=${resp.status}`, 'malformed');
  }
}

r.section('17. Path traversal on write endpoints');
{
  for (const path of [
    '/api/write/quests/../../../etc/passwd',
    '/api/write/%2e%2e/etc/passwd',
    '/api/quests/../../saves/DIM-1',
  ]) {
    const resp = await httpReq(PORT.BQ, path);
    const ok = isUp ? (resp.status === 200 || resp.status === 400 || resp.status === 404) : resp.status === 0;
    r.case(`path=${path.slice(0,50)}`, ok, `status=${resp.status}`, 'security');
  }
}

r.section('18. Concurrent reads');
{
  if (!isUp) { r.pass('skipped (bridge not up)'); }
  else {
    const start = Date.now();
    const N = 20;
    const results = await Promise.all(Array(N).fill(0).map(() => httpReq(PORT.BQ, '/api/questlines')));
    const ok = results.every(r => r.status === 200);
    const ms = Date.now() - start;
    r.case(`${N} parallel /api/questlines`, ok, `${ok ? 'all OK' : 'some failed'} in ${ms}ms`, 'performance');
    r.case(`${N} req < 5s`, ms < 5000, `${ms}ms`, 'performance');
  }
}

r.section('19. Oversized JSON body');
{
  const huge = JSON.stringify({ quest_id: 1, description: 'x'.repeat(2_000_000) });
  const resp = await httpReq(PORT.BQ, '/api/write/quests/update', { method: 'POST', body: huge, headers: { 'content-type': 'application/json' } }, { timeout: 15_000 });
  const ok = isUp ? (resp.status === 400 || resp.status === 200 || resp.status === 413) : resp.status === 0;
  r.case('2MB body', ok, `status=${resp.status}`, 'boundary');
}

r.print();
process.exit(r.failures.length > 0 ? 1 : 0);
