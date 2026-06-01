#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { FuzzReport, FUZZ_INPUTS, bridgeUp, COLORS, PORT, httpReq } from '../shared/harness.mjs';

const r = new FuzzReport('State Integration & Cross-Bridge Workflow Tests');

const jeiUp = await bridgeUp(PORT.JEI, 2000);
const bqUp = await bridgeUp(PORT.BQ, 2000);
console.log(`JEI bridge: ${jeiUp ? 'UP' : 'DOWN'}`);
console.log(`BQ bridge: ${bqUp ? 'UP' : 'DOWN'}`);

r.section('1. JEI read consistency');
{
  if (!jeiUp) { r.pass('skipped (bridge down)'); }
  else {
    const c1 = await httpReq(PORT.JEI, '/api/items/count');
    const c2 = await httpReq(PORT.JEI, '/api/items/count');
    r.case('count consistent across calls', c1.body?.count === c2.body?.count, `${c1.body?.count} vs ${c2.body?.count}`, 'consistency');

    const s1 = await httpReq(PORT.JEI, '/api/items/search?q=iron&limit=10');
    const s2 = await httpReq(PORT.JEI, '/api/items/search?q=iron&limit=10');
    r.case('search consistent', JSON.stringify(s1.body?.results) === JSON.stringify(s2.body?.results), `len=${s1.body?.results?.length} vs ${s2.body?.results?.length}`, 'consistency');
  }
}

r.section('2. JEI pagination integrity');
{
  if (!jeiUp) { r.pass('skipped'); }
  else {
    const page1 = await httpReq(PORT.JEI, '/api/items/all?limit=20&offset=0');
    const page2 = await httpReq(PORT.JEI, '/api/items/all?limit=20&offset=20');
    const ids1 = new Set((page1.body?.results || []).map(r => r.uid));
    const ids2 = new Set((page2.body?.results || []).map(r => r.uid));
    const overlap = [...ids1].filter(id => ids2.has(id));
    r.case('no overlap between page 1 and 2', overlap.length === 0, `overlap=${overlap.length}`, 'pagination');
  }
}

r.section('3. JEI recipe graph sanity');
{
  if (!jeiUp) { r.pass('skipped'); }
  else {
    const search = await httpReq(PORT.JEI, '/api/items/search?q=iron_ingot&limit=1');
    const uid = search.body?.results?.[0]?.uid;
    if (uid) {
      const recipes = await httpReq(PORT.JEI, `/api/items/${encodeURIComponent(uid)}/recipes?limit=5`);
      r.case(`recipes for ${uid}`, recipes.status === 200 && Array.isArray(recipes.body?.recipes), `n=${recipes.body?.recipes?.length}`, 'graph');
    } else {
      r.case('could not find iron_ingot', false, 'no search result', 'graph');
    }
  }
}

r.section('4. BQ read consistency');
{
  if (!bqUp) { r.pass('skipped (bridge down — load a world)'); }
  else {
    const c1 = await httpReq(PORT.BQ, '/api/health');
    const c2 = await httpReq(PORT.BQ, '/api/health');
    r.case('health consistent', c1.body?.quest_count === c2.body?.quest_count, `${c1.body?.quest_count} vs ${c2.body?.quest_count}`, 'consistency');
    const v1 = await httpReq(PORT.BQ, '/api/validate');
    const v2 = await httpReq(PORT.BQ, '/api/validate');
    r.case('validate consistent', v1.body?.count === v2.body?.count, `${v1.body?.count} vs ${v2.body?.count}`, 'consistency');
  }
}

r.section('5. BQ dry-run does not change state');
{
  if (!bqUp) { r.pass('skipped (bridge down — load a world)'); }
  else {
    const before = await httpReq(PORT.BQ, '/api/health');
    const beforeCount = before.body?.quest_count || 0;
    const dryrun = await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body: { quest_id: 99999998, line_id: 50, name: 'fuzz-dryrun-temp' } });
    r.case('dry-run create returns 200', dryrun.status === 200, `status=${dryrun.status} body=${JSON.stringify(dryrun.body).slice(0,150)}`, 'dry-run');
    r.case('dry-run response indicates dry_run', dryrun.body?.dry_run === true, `dry_run=${dryrun.body?.dry_run} commit=${dryrun.body?.commit}`, 'dry-run');
    r.case('dry-run has request_id', typeof dryrun.body?.request_id === 'string', `request_id=${dryrun.body?.request_id}`, 'dry-run');
    r.case('dry-run has duration_ms', typeof dryrun.body?.duration_ms === 'number', `duration_ms=${dryrun.body?.duration_ms}`, 'dry-run');
    r.case('dry-run has would_create', dryrun.body?.would_create === true, `would_create=${dryrun.body?.would_create}`, 'dry-run');
    const after = await httpReq(PORT.BQ, '/api/health');
    r.case('quest count UNCHANGED after dry-run', after.body?.quest_count === beforeCount, `before=${beforeCount} after=${after.body?.quest_count}`, 'dry-run');
    const check = await httpReq(PORT.BQ, '/api/quests/99999998');
    r.case('dry-run quest not visible in read', check.status === 404, `status=${check.status}`, 'dry-run');
  }
}

r.section('6. BQ dry-run safety: no backup created on dry-run');
{
  if (!bqUp) { r.pass('skipped'); }
  else {
    const fs = await import('node:fs');
    const path = '/home/ir192m2/Documents/curseforge/minecraft/Instances/NITRO-1.12.2/bqmcp/backups';
    const exists = fs.existsSync(path);
    if (!exists) { r.pass('backup dir not yet created (no commits performed)'); }
    else {
      const dirs = fs.readdirSync(path);
      const beforeCount = dirs.length;
      await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body: { quest_id: 99999996, line_id: 50, name: 'fuzz-dryrun-safety' } });
      const dirsAfter = fs.readdirSync(path);
      r.case('no new backup dir from dry-run', dirsAfter.length === beforeCount, `before=${beforeCount} after=${dirsAfter.length}`, 'safety');
    }
  }
}

r.section('7. BQ invalid commit rejected');
{
  if (!bqUp) { r.pass('skipped'); }
  else {
    const r1 = await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body: { quest_id: -1, line_id: 50, commit: true, name: 'bad' } });
    r.case('negative quest_id with commit=true (no backup attempted)', r1.status === 400, `status=${r1.status} body=${JSON.stringify(r1.body).slice(0,150)}`, 'validation');
  }
}

r.section('7b. BUG: BQ write with commit=true on missing questline hangs client');
{
  if (!bqUp) { r.pass('skipped'); }
  else {
    const r1 = await httpReq(PORT.BQ, '/api/write/quests/create', { method: 'POST', body: { quest_id: 99999995, line_id: 99999, commit: true, name: 'will-hang' } }, { timeout: 35_000 });
    r.case('commit=true with bad line_id responds (does not hang)', r1.status !== 0 || r1.body !== null, `status=${r1.status} error=${r1.error} body=${JSON.stringify(r1.body).slice(0,100)}`, 'bug-hang');
  }
}

r.section('8. Cross-bridge: BQ + JEI correlation');
{
  if (!jeiUp) { r.pass('JEI bridge down'); }
  else if (!bqUp) { r.pass('BQ bridge down — load a world to test cross-correlation'); }
  else {
    const qls = await httpReq(PORT.BQ, '/api/questlines');
    if (qls.body?.questlines?.length > 0) {
      r.case('at least one questline exists', true, `n=${qls.body.questlines.length}`);
    } else {
      r.pass('no questlines to test');
    }
    const jcount = await httpReq(PORT.JEI, '/api/items/count');
    r.case('JEI has items', jcount.body?.count > 0, `n=${jcount.body?.count}`);
  }
}

r.section('9. Stress: 50 mixed read calls in parallel');
{
  if (!jeiUp && !bqUp) { r.pass('both bridges down'); }
  else {
    const calls = [];
    if (jeiUp) for (let i = 0; i < 25; i++) calls.push(httpReq(PORT.JEI, '/api/items/count'));
    if (bqUp) for (let i = 0; i < 25; i++) calls.push(httpReq(PORT.BQ, '/api/health'));
    const start = Date.now();
    const results = await Promise.all(calls);
    const ms = Date.now() - start;
    const ok = results.every(r => r.status === 200);
    r.case(`50 parallel mixed reads`, ok, `${ok ? 'all OK' : 'some failed'} in ${ms}ms`, 'stress');
    r.case(`50 req < 10s`, ms < 10_000, `${ms}ms`, 'stress');
  }
}

r.section('10. Audit log file (BQ safety)');
{
  if (!bqUp) { r.pass('skipped'); }
  else {
    const fs = await import('node:fs');
    const auditPath = '/home/ir192m2/Documents/curseforge/minecraft/Instances/NITRO-1.12.2/bqmcp/audit.log';
    if (fs.existsSync(auditPath)) {
      const content = fs.readFileSync(auditPath, 'utf-8');
      r.case('audit log exists and non-empty', content.length > 0, `len=${content.length}`);
      const lines = content.split('\n').filter(l => l.trim());
      r.case('audit log has entries', lines.length > 0, `n=${lines.length}`);
      let allValid = true;
      let sample = '';
      for (const l of lines.slice(0, 5)) {
        try { JSON.parse(l); sample = l.slice(0, 80); } catch { allValid = false; sample = `INVALID: ${l.slice(0, 80)}`; break; }
      }
      r.case('all entries valid JSON', allValid, sample, 'audit');
    } else {
      r.pass('audit log not yet created');
    }
  }
}

r.print();
process.exit(r.failures.length > 0 ? 1 : 0);
