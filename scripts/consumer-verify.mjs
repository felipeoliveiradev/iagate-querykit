#!/usr/bin/env node
/**
 * Packs the current tree and installs the tarball into four fresh consumer
 * projects: ESM, CJS, TypeScript NodeNext, TypeScript bundler.
 * Prints exact results and exits non-zero on failure.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail) console.log(detail);
}

const packDir = mkdtempSync(join(tmpdir(), 'qk-pack-'));
try {
  run('npm pack --pack-destination ' + JSON.stringify(packDir), root);
  const tgz = run('ls ' + JSON.stringify(packDir), packDir)
    .trim()
    .split('\n')
    .find((f) => f.endsWith('.tgz'));
  const tarball = join(packDir, tgz);
  record('npm pack', true, tgz);

  // ESM
  {
    const dir = mkdtempSync(join(tmpdir(), 'qk-esm-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }));
    run(`npm install ${JSON.stringify(tarball)} better-sqlite3`, dir);
    writeFileSync(
      join(dir, 'app.mjs'),
      `
      import { QueryBuilder, setDefaultExecutor, table } from 'iagate-querykit';
      import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3';
      const exec = new BetterSqlite3Executor(':memory:');
      setDefaultExecutor(exec);
      exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
      await new QueryBuilder('users').insert({ email: 'esm@x.com' }).make();
      const rows = await table('users').where('email', '=', 'esm@x.com').all();
      if (rows[0].email !== 'esm@x.com') throw new Error('esm query mismatch');
      exec.close();
      console.log('esm-ok', rows[0].email);
      `,
    );
    try {
      const out = run('node app.mjs', dir);
      record('ESM import + sqlite query', out.includes('esm-ok'), out.trim());
    } catch (e) {
      record('ESM import + sqlite query', false, String(e.stderr || e.message));
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // CJS
  {
    const dir = mkdtempSync(join(tmpdir(), 'qk-cjs-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs', private: true }));
    run(`npm install ${JSON.stringify(tarball)} better-sqlite3`, dir);
    writeFileSync(
      join(dir, 'app.cjs'),
      `
      const { QueryBuilder, setDefaultExecutor } = require('iagate-querykit');
      const { BetterSqlite3Executor } = require('iagate-querykit/adapters/better-sqlite3');
      (async () => {
        const exec = new BetterSqlite3Executor(':memory:');
        setDefaultExecutor(exec);
        exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
        await new QueryBuilder('users').insert({ email: 'cjs@x.com' }).make();
        const rows = await new QueryBuilder('users').where('email', '=', 'cjs@x.com').all();
        if (rows[0].email !== 'cjs@x.com') throw new Error('cjs query mismatch');
        exec.close();
        console.log('cjs-ok', rows[0].email);
      })();
      `,
    );
    try {
      const out = run('node app.cjs', dir);
      record('CJS require + sqlite query', out.includes('cjs-ok'), out.trim());
    } catch (e) {
      record('CJS require + sqlite query', false, String(e.stderr || e.message));
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // TS NodeNext (typecheck + emit + run)
  {
    const dir = mkdtempSync(join(tmpdir(), 'qk-nodenext-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: false,
          outDir: 'out',
          skipLibCheck: false,
          types: ['node'],
        },
        include: ['app.ts'],
      }),
    );
    run(`npm install ${JSON.stringify(tarball)} typescript @types/node better-sqlite3`, dir);
    writeFileSync(
      join(dir, 'app.ts'),
      `
      import { QueryBuilder, setDefaultExecutor } from 'iagate-querykit';
      import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3';
      const exec = new BetterSqlite3Executor(':memory:');
      setDefaultExecutor(exec);
      exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
      const q: QueryBuilder<{ id: number; email: string }> = new QueryBuilder('users');
      await q.insert({ email: 'nodenext@x.com' }).make();
      const rows = await new QueryBuilder<{ email: string }>('users').where('email', 'nodenext@x.com').all();
      if (rows[0].email !== 'nodenext@x.com') throw new Error('nodenext query mismatch');
      exec.close();
      console.log('nodenext-ok', rows[0].email);
      `,
    );
    try {
      const tscOut = run('npx tsc -p tsconfig.json', dir);
      record('TypeScript moduleResolution: NodeNext', true, tscOut.trim() || 'tsc ok');
      const out = run('node out/app.js', dir);
      record('TypeScript NodeNext emit + sqlite query', out.includes('nodenext-ok'), out.trim());
    } catch (e) {
      record('TypeScript moduleResolution: NodeNext', false, String(e.stderr || e.stdout || e.message));
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // TS bundler (typecheck; Node cannot execute bundler-resolution output)
  {
    const dir = mkdtempSync(join(tmpdir(), 'qk-bundler-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
        },
        include: ['app.ts'],
      }),
    );
    run(`npm install ${JSON.stringify(tarball)} typescript @types/node better-sqlite3`, dir);
    writeFileSync(
      join(dir, 'app.ts'),
      `
      import { QueryBuilder, setDefaultExecutor, table } from 'iagate-querykit';
      import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3';
      const exec = new BetterSqlite3Executor(':memory:');
      setDefaultExecutor(exec);
      exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
      export const q = new QueryBuilder<{ id: number; email: string }>('users');
      void table;
      `,
    );
    try {
      const out = run('npx tsc -p tsconfig.json', dir);
      record('TypeScript moduleResolution: bundler', true, out.trim() || 'tsc ok');
    } catch (e) {
      record('TypeScript moduleResolution: bundler', false, String(e.stderr || e.stdout || e.message));
    }
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log('\n--- consumer-verify summary ---');
console.log(JSON.stringify(results, null, 2));
if (failed.length) process.exit(1);
