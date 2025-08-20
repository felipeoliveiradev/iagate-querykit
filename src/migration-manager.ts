import type { DatabaseExecutor } from './types'
import { QueryKitConfig } from './config'
import { QueryBuilder } from './query-builder'

export type MigrationStep = string | string[] | ((ctx: MigrationContext) => Promise<void> | void)
export type MigrationSpec = {
  id: string
  up: MigrationStep
  down?: MigrationStep
  tags?: string[]
}

export type MigrationContext = {
  exec: DatabaseExecutor
  dialect?: DatabaseExecutor['dialect']
  query: (sql: string, bindings?: any[]) => Promise<void>
  runSync: (sql: string, bindings?: any[]) => void
  qb: <T = any>(tableName: string) => QueryBuilder<T>
}

function getExec(explicit?: DatabaseExecutor): DatabaseExecutor {
  const exec = explicit || (QueryKitConfig as any).defaultExecutor
  if (!exec) throw new Error('No executor configured for QueryKit')
  return exec
}

function migrationsTableSql(dialect?: DatabaseExecutor['dialect']): string {
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS querykit_migrations (id VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW())`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS querykit_migrations (id VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    case 'mssql':
      return `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='querykit_migrations' and xtype='U') CREATE TABLE querykit_migrations (id NVARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT GETDATE())`
    case 'oracle':
      return `BEGIN EXECUTE IMMEDIATE 'CREATE TABLE querykit_migrations (id VARCHAR2(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;`
    default:
      return `CREATE TABLE IF NOT EXISTS querykit_migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  }
}

async function ensureTable(exec: DatabaseExecutor) {
  const sql = migrationsTableSql(exec.dialect)
  if ((exec as any).runSync) {
    (exec as any).runSync(sql, [])
  } else {
    await exec.executeQuery(sql, [])
  }
}

export async function listAppliedMigrations(executor?: DatabaseExecutor): Promise<string[]> {
  const exec = getExec(executor)
  await ensureTable(exec)
  const sql = `SELECT id FROM querykit_migrations ORDER BY applied_at ASC`
  if ((exec as any).executeQuerySync) {
    const res = (exec as any).executeQuerySync(sql, [])
    return ((res?.data as any[]) || []).map(r => r.id)
  }
  const res = await exec.executeQuery(sql, [])
  return ((res?.data as any[]) || []).map(r => r.id)
}

async function execStep(step: MigrationStep, ctx: MigrationContext): Promise<void> {
  if (typeof step === 'string') {
    await ctx.query(step)
    return
  }
  if (Array.isArray(step)) {
    for (const s of step) await execStep(s, ctx)
    return
  }
  await Promise.resolve((step as any)(ctx))
}

export async function migrateUp(migrations: MigrationSpec[], opts: { to?: string; executor?: DatabaseExecutor } = {}): Promise<{ applied: string[] }> {
  const exec = getExec(opts.executor)
  await ensureTable(exec)
  const applied = new Set(await listAppliedMigrations(exec))
  const target = opts.to
  const ctx: MigrationContext = {
    exec,
    dialect: exec.dialect,
    query: async (sql: string, bindings: any[] = []) => { await exec.executeQuery(sql, bindings) },
    runSync: (sql: string, bindings: any[] = []) => {
      if ((exec as any).runSync) {
        (exec as any).runSync(sql, bindings)
      } else {
        throw new Error('runSync not supported by executor')
      }
    },
    qb: <T=any>(name: string) => new QueryBuilder<T>(name)
  }
  const newlyApplied: string[] = []
  for (const mig of migrations) {
    if (applied.has(mig.id)) {
      if (target && mig.id === target) break
      continue
    }
    await execStep(mig.up, ctx)
    const ins = `INSERT INTO querykit_migrations (id) VALUES (?)`
    if ((exec as any).runSync) {
      (exec as any).runSync(ins, [mig.id])
    } else {
      await exec.executeQuery(ins, [mig.id])
    }
    newlyApplied.push(mig.id)
    if (target && mig.id === target) break
  }
  return { applied: newlyApplied }
}

export async function migrateDown(migrations: MigrationSpec[], opts: { to?: string; steps?: number; executor?: DatabaseExecutor } = {}): Promise<{ reverted: string[] }> {
  const exec = getExec(opts.executor)
  await ensureTable(exec)
  const applied = await listAppliedMigrations(exec)
  const byId: Record<string, MigrationSpec> = {}
  migrations.forEach(m => { byId[m.id] = m })
  const ctx: MigrationContext = {
    exec,
    dialect: exec.dialect,
    query: async (sql: string, bindings: any[] = []) => { await exec.executeQuery(sql, bindings) },
    runSync: (sql: string, bindings: any[] = []) => {
      if ((exec as any).runSync) {
        (exec as any).runSync(sql, bindings)
      } else {
        throw new Error('runSync not supported by executor')
      }
    },
    qb: <T=any>(name: string) => new QueryBuilder<T>(name)
  }
  const target = opts.to
  let remaining = typeof opts.steps === 'number' ? Math.max(0, opts.steps) : Infinity
  const reverted: string[] = []
  for (let i = applied.length - 1; i >= 0 && remaining > 0; i--) {
    const id = applied[i]
    const mig = byId[id]
    if (!mig) continue
    if (mig.down) {
      await execStep(mig.down, ctx)
    }
    const del = `DELETE FROM querykit_migrations WHERE id = ?`
    if ((exec as any).runSync) {
      (exec as any).runSync(del, [id])
    } else {
      await exec.executeQuery(del, [id])
    }
    reverted.push(id)
    remaining--
    if (target && id === target) break
  }
  return { reverted }
}

export async function resetMigrations(opts: { executor?: DatabaseExecutor } = {}): Promise<void> {
  const exec = getExec(opts.executor)
  const dropSql = `DROP TABLE IF EXISTS querykit_migrations`
  if ((exec as any).runSync) {
    (exec as any).runSync(dropSql, [])
  } else {
    await exec.executeQuery(dropSql, [])
  }
} 