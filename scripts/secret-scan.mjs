#!/usr/bin/env node
/**
 * Pre-publish / CI secret scan.
 *
 * NEVER prints a secret value — only location, type, and a short mask.
 * Exit 1 if a non-allowlisted finding is present.
 *
 * Checks the working tree (source, workflows, compose, docs) and, when
 * present, `dist/` (what `files: ["dist"]` would publish). Optionally
 * runs gitleaks when the binary is on PATH.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'coverage',
  'website/node_modules',
]);

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.node',
]);

const HIGH_RISK_NAME = [
  /^\.env($|\.)/i,
  /^\.pypirc$/i,
  /id_rsa/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
];

const PATTERNS = [
  { type: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'github_pat', re: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { type: 'github_fine_grained', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { type: 'npm_token', re: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { type: 'private_key_block', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g },
  { type: 'npmrc_auth', re: /(?:_authToken|_auth)\s*=\s*\S+/gi },
  { type: 'connection_string', re: /\b(?:postgres|postgresql|mysql|mariadb|mongodb|mssql|sqlserver|oracle|redis):\/\/[^\s'"`]+/gi },
];

const ALLOW_PASSWORD = new Set([
  'querykit',
  'QueryKit_123',
  'QueryKit123',
  'password-super-secret',
  'super-secret-token',
  'secret',
  'tiger',
  'Passw0rd!',
  'pass',
  'p',
  'x',
]);

const ALLOW_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.test',
  'x.com',
  'gmail.com',
  'test.com',
  'company.com',
  'temp.com',
  'disposable.com',
]);

const ALLOW_EMAILS = new Set(['felipeoliveiradeveloper@gmail.com']);

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function mask(value) {
  const s = String(value ?? '');
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}…${s.slice(-2)} (len=${s.length})`;
}

function fingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12);
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(ROOT, p);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(rel)) continue;
      walk(p, acc);
    } else if (e.isFile()) {
      acc.push(p);
    }
  }
  return acc;
}

export function classifyFinding(type, value) {
  if (type === 'connection_string') {
    const host = value.match(/@([^/:]+)/)?.[1] || value.match(/:\/\/([^/:]+)/)?.[1] || '';
    const h = host.toLowerCase();
    if (!host || LOOPBACK.has(h)) return 'allow_loopback';
    if (
      h.endsWith('.example.com') ||
      h.endsWith('.internal') ||
      h === 'prod-db.internal' ||
      /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h)
    ) {
      return 'allow_rejection_fixture';
    }
    return 'review';
  }
  if (type === 'aws_access_key' && /EXAMPLE/.test(value)) return 'allow_aws_example';
  return 'review';
}

export function scanText(text) {
  const hits = [];
  if (!text) return hits;
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[0];
      const classification = classifyFinding(type, value);
      hits.push({
        type,
        classification,
        fp: fingerprint(value),
        len: value.length,
        masked: mask(value),
      });
    }
  }
  return hits;
}

function scanFile(file) {
  const rel = relative(ROOT, file);
  const name = rel.split(/[/\\]/).pop() || rel;
  const hits = [];

  if (name === '.npmrc') {
    const body = readFileSync(file, 'utf8');
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const allowed = new Set(['legacy-peer-deps=true']);
    for (const line of lines) {
      if (!allowed.has(line)) {
        hits.push({
          file: rel,
          type: 'npmrc_unexpected',
          classification: 'review',
          fp: fingerprint(line),
          len: line.length,
          masked: mask(line),
        });
      }
    }
    return hits;
  }

  for (const re of HIGH_RISK_NAME) {
    if (re.test(name) || re.test(rel)) {
      hits.push({
        file: rel,
        type: 'high_risk_filename',
        classification: 'review',
        name,
      });
    }
  }

  const ext = extname(file).toLowerCase();
  if (BINARY_EXT.has(ext)) return hits;
  let st;
  try {
    st = statSync(file);
  } catch {
    return hits;
  }
  if (st.size > 2_000_000) return hits;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return hits;
  }
  if (buf.includes(0)) return hits;
  for (const h of scanText(buf.toString('utf8'))) {
    hits.push({ file: rel, ...h });
  }
  return hits;
}

function runGitleaks() {
  const bin = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (bin.status !== 0 && bin.error) {
    return { skipped: true, reason: 'gitleaks_not_installed' };
  }
  const report = join(ROOT, `.gitleaks-report-${randomBytes(4).toString('hex')}.json`);
  const args = [
    'detect',
    '--source',
    ROOT,
    '--no-git',
    '--no-banner',
    '--redact=100',
    '--report-format',
    'json',
    '--report-path',
    report,
  ];
  if (existsSync(join(ROOT, '.gitleaks.toml'))) {
    args.push('--config', join(ROOT, '.gitleaks.toml'));
  }
  const res = spawnSync('gitleaks', args, { encoding: 'utf8' });
  let findings = [];
  if (existsSync(report)) {
    try {
      const raw = readFileSync(report, 'utf8').trim();
      findings = raw ? JSON.parse(raw) : [];
    } catch {
      findings = [];
    }
    try {
      execFileSync('rm', ['-f', report]);
    } catch {
      /* ignore */
    }
  }
  return {
    skipped: false,
    exit: res.status,
    count: findings.length,
    findings: findings.map((f) => ({
      rule: f.RuleID || f.Description || 'unknown',
      file: f.File || '',
      line: f.StartLine ?? null,
    })),
  };
}

function main() {
  const files = walk(ROOT).filter((p) => {
    const rel = relative(ROOT, p);
    if (rel.startsWith('website/build/') || rel.startsWith('website/.docusaurus/')) return false;
    return true;
  });

  const hits = [];
  for (const f of files) hits.push(...scanFile(f));
  const review = hits.filter((h) => h.classification === 'review');

  const gitleaks = runGitleaks();

  for (const h of review) {
    console.error(
      `[secret-scan] ${h.type} file=${h.file} class=${h.classification} fp=${h.fp || ''} len=${h.len || ''} ${h.masked || ''} ${h.name || ''}`,
    );
  }
  if (!gitleaks.skipped) {
    console.log(`[secret-scan] gitleaks worktree findings=${gitleaks.count}`);
    for (const f of gitleaks.findings) {
      console.error(`[secret-scan] gitleaks rule=${f.rule} file=${f.file} line=${f.line}`);
    }
  } else {
    console.log(`[secret-scan] gitleaks skipped (${gitleaks.reason})`);
  }

  console.log(
    `[secret-scan] files=${files.length} review=${review.length} allowlisted=${hits.length - review.length}`,
  );

  if (review.length > 0 || (gitleaks.count || 0) > 0) {
    process.exit(1);
  }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) main();
