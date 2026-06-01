#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { FuzzReport, COLORS, bridgeUp, PORT } from './shared/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'reports');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const sections = [
  { name: 'BQ HTTP', args: [resolve(__dirname, 'bq/http-fuzz.mjs')] },
  { name: 'BQ MCP', args: [resolve(__dirname, 'bq/mcp-fuzz.mjs')] },
  { name: 'State Integration', args: [resolve(__dirname, 'shared/state-integration.mjs')] },
];

const results = {};
let totalPass = 0, totalFail = 0, totalTests = 0;

for (const s of sections) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}╔════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}║  Running: ${s.name.padEnd(30)} ║${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}╚════════════════════════════════════════╝${COLORS.reset}\n`);
  const t0 = Date.now();
  const proc = spawn('node', s.args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); process.stdout.write(d); });
  proc.stderr.on('data', d => { stderr += d.toString(); });
  await new Promise((resolve) => proc.on('exit', (code) => {
    const elapsed = Date.now() - t0;
    const m = stdout.match(/Summary: (\d+)\/(\d+) passed, (\d+) failed/);
    if (m) {
      const pass = parseInt(m[1]), total = parseInt(m[2]), fail = parseInt(m[3]);
      results[s.name] = { pass, fail, total, elapsed, exitCode: code };
      totalPass += pass; totalFail += fail; totalTests += total;
    } else {
      results[s.name] = { pass: 0, fail: 0, total: 0, elapsed, exitCode: code, error: 'no summary found' };
    }
    resolve();
  }));
}

console.log(`\n\n${COLORS.bold}${COLORS.cyan}╔════════════════════════════════════════════════════════════╗${COLORS.reset}`);
console.log(`${COLORS.bold}${COLORS.cyan}║              AGGREGATE FUZZ TEST REPORT                      ║${COLORS.reset}`);
console.log(`${COLORS.bold}${COLORS.cyan}╚════════════════════════════════════════════════════════════╝${COLORS.reset}\n`);

for (const [name, r] of Object.entries(results)) {
  const color = r.fail === 0 ? COLORS.green : COLORS.red;
  const pct = r.total > 0 ? Math.round(r.pass/r.total*100) : 0;
  console.log(`${color}${name.padEnd(25)} ${r.pass}/${r.total} (${pct}%) — ${r.fail} fail, ${r.elapsed}ms, exit ${r.exitCode}${COLORS.reset}`);
}
console.log(`\n${COLORS.bold}Total: ${totalPass}/${totalTests} passed, ${totalFail} failed across ${sections.length} fuzzer suites${COLORS.reset}\n`);

const report = {
  timestamp: new Date().toISOString(),
  bridges: { jei: await bridgeUp(PORT.JEI, 1000), bq: await bridgeUp(PORT.BQ, 1000) },
  suites: results,
  total: { pass: totalPass, fail: totalFail, tests: totalTests },
};
writeFileSync(resolve(OUT_DIR, 'aggregate.json'), JSON.stringify(report, null, 2));
console.log(`\nReport saved to ${OUT_DIR}/aggregate.json`);
process.exit(totalFail > 0 ? 1 : 0);
