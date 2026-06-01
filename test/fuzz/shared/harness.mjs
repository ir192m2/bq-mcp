#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const HARNESS_START = performance.now();

export const COLORS = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};

export class FuzzReport {
  constructor(name) {
    this.name = name;
    this.sections = [];
    this.failures = [];
    this.startTime = performance.now();
  }

  section(title) {
    this.sections.push({ title, cases: [], start: performance.now() });
  }

  case(name, passed, detail, category = 'general') {
    const last = this.sections[this.sections.length - 1];
    last.cases.push({ name, passed, detail, category });
    if (!passed) this.failures.push({ name, detail, category, section: last.title });
  }

  pass(name, detail = '', category = 'general') { this.case(name, true, detail, category); }
  fail(name, detail, category = 'general') { this.case(name, false, detail, category); }

  async time(name, fn, category = 'general') {
    const t = performance.now();
    let passed = false, detail = '';
    try {
      const r = await fn();
      passed = r === true || r === undefined;
      if (typeof r === 'string') { passed = true; detail = r; }
      else if (r && typeof r === 'object' && r.ok !== undefined) { passed = r.ok; detail = r.detail || ''; }
    } catch (e) { passed = false; detail = e.message; }
    this.case(name, passed, `${detail} (${Math.round(performance.now()-t)}ms)`, category);
    return passed;
  }

  print() {
    const total = this.sections.reduce((a,s) => a + s.cases.length, 0);
    const pass = this.sections.reduce((a,s) => a + s.cases.filter(c => c.passed).length, 0);
    const fail = total - pass;
    const elapsed = Math.round(performance.now() - this.startTime);
    const totalElapsed = Math.round(performance.now() - HARNESS_START);

    console.log(`\n${COLORS.bold}${COLORS.cyan}=== ${this.name} ===${COLORS.reset}`);
    for (const s of this.sections) {
      const s_pass = s.cases.filter(c => c.passed).length;
      const s_fail = s.cases.length - s_pass;
      const color = s_fail > 0 ? COLORS.red : COLORS.green;
      console.log(`\n${COLORS.bold}${s.title}${COLORS.reset}  ${color}${s_pass}/${s.cases.length} passed${COLORS.reset}`);
      const cats = {};
      for (const c of s.cases) {
        cats[c.category] = cats[c.category] || { pass: 0, fail: 0 };
        if (c.passed) cats[c.category].pass++;
        else cats[c.category].fail++;
      }
      for (const cat of Object.keys(cats)) {
        const c = cats[cat];
        const cc = c.fail > 0 ? COLORS.red : COLORS.dim;
        console.log(`  ${cc}${cat}: ${c.pass}/${c.pass+c.fail}${COLORS.reset}`);
      }
      for (const c of s.cases) {
        if (!c.passed) {
          console.log(`  ${COLORS.red}FAIL${COLORS.reset}  ${c.name}`);
          console.log(`        ${c.detail}`);
        }
      }
    }
    console.log(`\n${COLORS.bold}Summary: ${pass}/${total} passed, ${fail} failed (${elapsed}ms section, ${totalElapsed}ms total)${COLORS.reset}`);
    return { total, pass, fail, elapsed };
  }
}

export async function withTimeout(promise, ms, label) {
  let to;
  const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(to);
  }
}

export const FUZZ_INPUTS = {
  empty: '',
  whitespace: '   ',
  veryLong: 'x'.repeat(100_000),
  huge: 'x'.repeat(1_000_000),
  nullByte: 'quest\u0000name',
  sqlInject: "'; DROP TABLE items;--",
  sqlInject2: "' OR '1'='1",
  pathTraversal: '../../../etc/passwd',
  pathTraversal2: '..%2F..%2F..%2Fetc%2Fpasswd',
  pathTraversal3: '/etc/passwd',
  xss: '<script>alert("xss")</script>',
  unicode: '🎮⚔️🛡️日本語',
  emoji: '🍕🍔🌮',
  newlineInjection: 'quest\nfakeheader: value',
  crlf: 'quest\r\nset-cookie: evil=1',
  null: null,
  undefined: undefined,
  bool: true,
  bool2: false,
  number: 42,
  array: [1,2,3],
  nested: { a: { b: { c: { d: { e: 1 } } } } },
  deepJson: '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{"j":{"k":{"l":{"m":1}}}}}}}}}}}}',
  intMax: Number.MAX_SAFE_INTEGER,
  intMaxBig: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
  intMin: -1,
  intOverflow: 99999999999999999999,
  float: 3.14159,
  nan: NaN,
  inf: Infinity,
  negInf: -Infinity,
  allSpecial: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~',
  zero: 0,
  negative: -42,
  hex: '\\x00\\xff',
  octal: '\\u0000\\u00ff',
  mcedFilename: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
  bqReserved: 'CON PRN AUX NUL COM1 LPT1',
  tooDeep: JSON.stringify({ a: 1 }).repeat(5000),
  recJson: '{"x":' + '['.repeat(100) + '1' + ']'.repeat(100) + '}',
};

export const PORT = {
  JEI: 18732,
  BQ: 18733,
};

export async function bridgeUp(port, timeoutMs = 3000) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
    clearTimeout(to);
    return resp.ok;
  } catch { return false; }
}

export async function httpReq(port, path, opts = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const controller = new AbortController();
  const timeout = opts.timeout ?? 10_000;
  const to = setTimeout(() => controller.abort(), timeout);
  const fetchOpts = { method: opts.method || 'GET', signal: controller.signal, headers: opts.headers || {} };
  if (opts.body !== undefined) {
    fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (!fetchOpts.headers['content-type'] && !fetchOpts.headers['Content-Type']) {
      fetchOpts.headers['content-type'] = 'application/json';
    }
  }
  try {
    const start = performance.now();
    const resp = await fetch(url, fetchOpts);
    const text = await resp.text();
    const ms = Math.round(performance.now() - start);
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: resp.status, body, ms, headers: resp.headers };
  } catch (e) {
    return { status: 0, body: null, ms: 0, error: e.message };
  } finally {
    clearTimeout(to);
  }
}

export async function mcpCall(serverCmd, serverArgs, method, params = null, id = 1, env = {}) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const proc = spawn(serverCmd, serverArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '', stderr = '';
    const to = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ error: 'timeout', stdout, stderr });
    }, 10_000);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const msg = { jsonrpc: '2.0', id, method };
    if (params !== null) msg.params = params;
    proc.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => {
      proc.stdin.end();
      setTimeout(() => {
        clearTimeout(to);
        proc.kill('SIGTERM');
        const lines = stdout.split('\n').filter(l => l.trim());
        let last = null;
        for (const l of lines) {
          try { last = JSON.parse(l); } catch {}
        }
        resolve({ response: last, stdout, stderr });
      }, 200);
    }, 500);
  });
}
