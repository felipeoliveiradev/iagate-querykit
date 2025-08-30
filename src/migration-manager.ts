import type { DatabaseExecutor } from './types'
import { QueryKitConfig } from './config'
import { QueryBuilder } from './query-builder'

/**
 * Passo de migração que pode ser string SQL, array de strings ou função.
 * Suporta execução síncrona e assíncrona.
 */
export type MigrationStep = string | string[] | ((ctx: MigrationContext) => Promise<void> | void)

/**
 * Especificação completa de uma migração.
 * Define como aplicar e reverter mudanças no banco de dados.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const migration: MigrationSpec = {
 *   id: '001_create_users_table',
 *   up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 *   down: 'DROP TABLE users',
 *   tags: ['schema', 'users']
 * };
 * 
 * // Como usar
 * await migrateUp([migration]);
 * 
 * // Output: Tabela 'users' criada no banco de dados
 * ```
 */
export type MigrationSpec = {
  /** Identificador único da migração */
  id: string
  /** Passos para aplicar a migração */
  up: MigrationStep
  /** Passos opcionais para reverter a migração */
  down?: MigrationStep
  /** Tags opcionais para categorização */
  tags?: string[]
}

/**
 * Contexto passado para execução de migrações.
 * Fornece acesso ao executor, dialeto e utilitários de query.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const context: MigrationContext = {
 *   exec: databaseExecutor,
 *   dialect: 'postgres',
 *   query: async (sql, bindings) => { executa query },
 *   runSync: (sql, bindings) => { executa query síncrona  },
 *   qb: (tableName) => new QueryBuilder(tableName)
 * };
 * 
 * // Como usar
 * // Contexto passado para função de migração
 * 
 * // Output: Contexto configurado para execução de migração
 * ```
 */
export type MigrationContext = {
  /** Executor do banco de dados */
  exec: DatabaseExecutor
  /** Dialeto SQL do banco */
  dialect?: DatabaseExecutor['dialect']
  /** Função para executar queries assíncronas */
  query: (sql: string, bindings?: any[]) => Promise<void>
  /** Função para executar queries síncronas */
  runSync: (sql: string, bindings?: any[]) => void
  /** Factory para criar QueryBuilders */
  qb: <T = any>(tableName: string) => QueryBuilder<T>
}

/**
 * Obtém executor do banco de dados, priorizando o explícito.
 * 
 * @param explicit - Executor explícito opcional
 * @returns Executor configurado
 * @throws Error se nenhum executor estiver disponível
 */
function getExec(explicit?: DatabaseExecutor): DatabaseExecutor {
  const exec = explicit || (QueryKitConfig as any).defaultExecutor
  if (!exec) throw new Error('No executor configured for QueryKit')
  return exec
}

/**
 * Retorna SQL para criar tabela de migrações baseado no dialeto.
 * Suporta múltiplos bancos de dados com sintaxes específicas.
 * 
 * @param dialect - Dialeto SQL do banco
 * @returns SQL para criar tabela de migrações
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const dialect = 'postgres';
 * 
 * // Como usar
 * const sql = migrationsTableSql(dialect);
 * 
 * // Output: "CREATE TABLE IF NOT EXISTS querykit_migrations..."
 * ```
 */
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

/**
 * Garante que a tabela de migrações existe no banco.
 * Cria a tabela se não existir.
 * 
 * @param exec - Executor do banco de dados
 * @returns Promise que resolve quando a tabela for criada
 */
async function ensureTable(exec: DatabaseExecutor) {
  const sql = migrationsTableSql(exec.dialect)
  if ((exec as any).runSync) {
    (exec as any).runSync(sql, [])
  } else {
    await exec.executeQuery(sql, [])
  }
}

/**
 * Lista todas as migrações já aplicadas no banco.
 * 
 * @param executor - Executor opcional (usa padrão se não fornecido)
 * @returns Promise que resolve com array de IDs de migrações aplicadas
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const executor = databaseExecutor;
 * 
 * // Como usar
 * const appliedMigrations = await listAppliedMigrations(executor);
 * 
 * // Output: ['001_create_users', '002_add_email_column']
 * ```
 */
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

/**
 * Executa um passo de migração individual.
 * Suporta strings SQL, arrays e funções.
 * 
 * @param step - Passo da migração para executar
 * @param ctx - Contexto da migração
 * @returns Promise que resolve quando o passo for executado
 */
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

/**
 * Aplica migrações para cima (up) até um alvo específico.
 * Executa migrações não aplicadas em ordem sequencial.
 * 
 * @param migrations - Array de especificações de migração
 * @param opts - Opções incluindo alvo e executor
 * @returns Promise que resolve com lista de migrações aplicadas
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const migrations = [
 *   { id: '001_create_users', up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)' },
 *   { id: '002_add_email', up: 'ALTER TABLE users ADD COLUMN email TEXT' }
 * ];
 * 
 * // Como usar
 * const result = await migrateUp(migrations, { to: '002_add_email' });
 * 
 * // Output: { applied: ['001_create_users', '002_add_email'] }
 * ```
 */
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

/**
 * Reverte migrações para baixo (down) até um alvo específico.
 * Executa passos de reversão em ordem reversa.
 * 
 * @param migrations - Array de especificações de migração
 * @param opts - Opções incluindo alvo, número de passos e executor
 * @returns Promise que resolve com lista de migrações revertidas
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const migrations = [
 *   { id: '001_create_users', up: 'CREATE TABLE users', down: 'DROP TABLE users' },
 *   { id: '002_add_email', up: 'ALTER TABLE users ADD email', down: 'ALTER TABLE users DROP email' }
 * ];
 * 
 * // Como usar
 * const result = await migrateDown(migrations, { steps: 1 });
 * 
 * // Output: { reverted: ['002_add_email'] }
 * ```
 */
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

/**
 * Remove completamente a tabela de migrações.
 * Útil para resetar o estado de migrações.
 * 
 * @param opts - Opções incluindo executor
 * @returns Promise que resolve quando a tabela for removida
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const executor = databaseExecutor;
 * 
 * // Como usar
 * await resetMigrations({ executor });
 * 
 * // Output: Tabela de migrações removida, estado resetado
 * ```
 */
export async function resetMigrations(opts: { executor?: DatabaseExecutor } = {}): Promise<void> {
  const exec = getExec(opts.executor)
  const dropSql = `DROP TABLE IF EXISTS querykit_migrations`
  if ((exec as any).runSync) {
    (exec as any).runSync(dropSql, [])
  } else {
    await exec.executeQuery(dropSql, [])
  }
} 