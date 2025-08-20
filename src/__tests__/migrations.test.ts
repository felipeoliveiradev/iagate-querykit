import { describe, it, expect, beforeEach } from 'vitest'
import { setDefaultExecutor } from '../config'
import type { DatabaseExecutor } from '../types'
import { migrateUp, migrateDown, listAppliedMigrations, resetMigrations, type MigrationSpec } from '../migration-manager'
import { migration, MigrationBuilder, ColumnType, ColumnDefault } from '../migration-dsl'

class Exec implements DatabaseExecutor {
  constructor(public dialect: any = 'sqlite') {}
  private migrations: string[] = []
  private seenSql: string[] = []
  executeQuerySync?(sql: string, bindings: any[]): { data: any[] } {
    if (/SELECT id FROM querykit_migrations/.test(sql)) { return { data: this.migrations.map(id => ({ id })) } }
    if (/CREATE TABLE IF NOT EXISTS querykit_migrations/.test(sql)) return { data: [] }
    if (/DELETE FROM querykit_migrations/.test(sql)) { this.migrations = this.migrations.filter(id => id !== bindings[0]); return { data: [] } }
    if (/INSERT INTO querykit_migrations/.test(sql)) { this.migrations.push(bindings[0]); return { data: [] } }
    this.seenSql.push(sql)
    return { data: [] }
  }
  async executeQuery(sql: string, bindings: any[] = []) {
    if (/CREATE TABLE IF NOT EXISTS querykit_migrations/.test(sql)) return { data: [] }
    if (/INSERT INTO querykit_migrations/.test(sql)) { this.migrations.push(bindings[0]); return { data: [] } }
    if (/SELECT id FROM querykit_migrations/.test(sql)) { return { data: this.migrations.map(id => ({ id })) } }
    if (/DELETE FROM querykit_migrations/.test(sql)) { this.migrations = this.migrations.filter(id => id !== bindings[0]); return { data: [] } }
    this.seenSql.push(sql)
    return { data: [] }
  }
  getSeen() { return this.seenSql.slice() }
}

describe('MigrationManager', () => {
  beforeEach(async () => { setDefaultExecutor(new Exec() as any); await resetMigrations() })

  it('applies migrations and records them', async () => {
    const migrations: MigrationSpec[] = [
      { id: '001_init', up: "CREATE TABLE t1(id INT)" },
      { id: '002_more', up: ["CREATE TABLE t2(id INT)", "CREATE TABLE t3(id INT)"] },
    ]
    const res = await migrateUp(migrations)
    expect(res.applied).toEqual(['001_init','002_more'])
    const list = await listAppliedMigrations()
    expect(list).toEqual(['001_init','002_more'])
  })

  it('runs down to target', async () => {
    const migrations: MigrationSpec[] = [
      { id: '001_init', up: "CREATE TABLE t1(id INT)", down: "DROP TABLE t1" },
      { id: '002_more', up: "CREATE TABLE t2(id INT)", down: "DROP TABLE t2" },
      { id: '003_last', up: "CREATE TABLE t3(id INT)", down: "DROP TABLE t3" },
    ]
    await migrateUp(migrations)
    const downRes = await migrateDown(migrations, { to: '001_init' })
    expect(downRes.reverted).toEqual(['003_last','002_more','001_init'])
    const list = await listAppliedMigrations()
    expect(list).toEqual([])
  })

  it('supports callback steps', async () => {
    const created: string[] = []
    const migrations: MigrationSpec[] = [
      { id: '001_init', up: async (ctx) => { await ctx.query("CREATE TABLE t1(id INT)"); created.push('ok') } },
    ]
    const res = await migrateUp(migrations)
    expect(res.applied).toEqual(['001_init'])
    expect(created).toEqual(['ok'])
  })

  it('ColumnType and ColumnDefault map per dialect', async () => {
    const mk = (dialect: any) => new Exec(dialect)
    const spec = (id: string) => ({ id, up: migration((b: MigrationBuilder) => {
      b.createTable('t', {
        id: { type: ColumnType.Int, primaryKey: true },
        name: { type: ColumnType.String, length: 50, notNull: true },
        amount: { type: ColumnType.Decimal, precision: 12, scale: 2 },
        on_at: { type: ColumnType.DateTime, default: ColumnDefault.CurrentTimestamp },
        flag: { type: ColumnType.Boolean, default: 1 },
      })
    }) })
    const cases: Array<[any, RegExp[]]> = [
      ['sqlite', [/CREATE TABLE t \(id INTEGER PRIMARY KEY, name VARCHAR\(50\) NOT NULL, amount NUMERIC\(12,2\), on_at DATETIME DEFAULT CURRENT_TIMESTAMP, flag INTEGER DEFAULT 1\)/i]],
      ['mysql', [/CREATE TABLE t \(id INT PRIMARY KEY, name VARCHAR\(50\) NOT NULL, amount DECIMAL\(12,2\), on_at DATETIME DEFAULT CURRENT_TIMESTAMP, flag TINYINT\(1\) DEFAULT 1\)/i]],
      ['postgres', [/CREATE TABLE t \(id INTEGER PRIMARY KEY, name VARCHAR\(50\) NOT NULL, amount DECIMAL\(12,2\), on_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, flag BOOLEAN DEFAULT 1\)/i]],
      ['mssql', [/CREATE TABLE t \(id INT PRIMARY KEY, name NVARCHAR\(50\) NOT NULL, amount DECIMAL\(12,2\), on_at DATETIME2 DEFAULT GETDATE\(\), flag BIT DEFAULT 1\)/i]],
    ]
    for (const [dialect, patterns] of cases) {
      const ex = mk(dialect)
      setDefaultExecutor(ex as any)
      await resetMigrations({ executor: ex as any })
      await migrateUp([spec(`${dialect}_001`)], { executor: ex as any })
      const sql = (ex as any).getSeen().join('\n')
      for (const p of patterns) expect(sql).toMatch(p)
    }
  })

  it('maps all ColumnTypes per dialect', async () => {
    const buildAllTypes = () => migration((b: MigrationBuilder) => {
      b.createTable('t', {
        c_int: { type: ColumnType.Int },
        c_bigint: { type: ColumnType.BigInt },
        c_float: { type: ColumnType.Float },
        c_double: { type: ColumnType.Double },
        c_dec: { type: ColumnType.Decimal, precision: 12, scale: 2 },
        c_str: { type: ColumnType.String, length: 100 },
        c_vc: { type: ColumnType.Varchar, length: 100 },
        c_text: { type: ColumnType.Text },
        c_date: { type: ColumnType.Date },
        c_time: { type: ColumnType.Time },
        c_dt: { type: ColumnType.DateTime },
        c_ts: { type: ColumnType.Timestamp },
        c_tstz: { type: ColumnType.TimestampTz },
        c_bool: { type: ColumnType.Boolean },
        c_json: { type: ColumnType.Json },
        c_uuid: { type: ColumnType.Uuid },
        c_bin: { type: ColumnType.Binary },
      })
    })
    const expectations: Record<string, Record<string, RegExp>> = {
      sqlite: {
        c_int: /c_int INTEGER(?!\w)/i,
        c_bigint: /c_bigint BIGINT/i,
        c_float: /c_float REAL/i,
        c_double: /c_double DOUBLE/i,
        c_dec: /c_dec NUMERIC\(12,2\)/i,
        c_str: /c_str VARCHAR\(100\)/i,
        c_vc: /c_vc VARCHAR\(100\)/i,
        c_text: /c_text TEXT/i,
        c_date: /c_date DATE/i,
        c_time: /c_time TEXT/i,
        c_dt: /c_dt DATETIME/i,
        c_ts: /c_ts DATETIME/i,
        c_tstz: /c_tstz DATETIME/i,
        c_bool: /c_bool INTEGER/i,
        c_json: /c_json TEXT/i,
        c_uuid: /c_uuid CHAR\(36\)/i,
        c_bin: /c_bin BLOB/i,
      },
      mysql: {
        c_int: /c_int INT(?!\w)/i,
        c_bigint: /c_bigint BIGINT/i,
        c_float: /c_float FLOAT/i,
        c_double: /c_double DOUBLE/i,
        c_dec: /c_dec DECIMAL\(12,2\)/i,
        c_str: /c_str VARCHAR\(100\)/i,
        c_vc: /c_vc VARCHAR\(100\)/i,
        c_text: /c_text TEXT/i,
        c_date: /c_date DATE/i,
        c_time: /c_time TIME/i,
        c_dt: /c_dt DATETIME/i,
        c_ts: /c_ts DATETIME/i,
        c_tstz: /c_tstz TIMESTAMP/i,
        c_bool: /c_bool TINYINT\(1\)/i,
        c_json: /c_json JSON/i,
        c_uuid: /c_uuid CHAR\(36\)/i,
        c_bin: /c_bin BLOB/i,
      },
      postgres: {
        c_int: /c_int INTEGER(?!\w)/i,
        c_bigint: /c_bigint BIGINT/i,
        c_float: /c_float REAL/i,
        c_double: /c_double DOUBLE PRECISION/i,
        c_dec: /c_dec DECIMAL\(12,2\)/i,
        c_str: /c_str VARCHAR\(100\)/i,
        c_vc: /c_vc VARCHAR\(100\)/i,
        c_text: /c_text TEXT/i,
        c_date: /c_date DATE/i,
        c_time: /c_time TIME(?!\w)/i,
        c_dt: /c_dt TIMESTAMP(?!\w)/i,
        c_ts: /c_ts TIMESTAMP(?!\w)/i,
        c_tstz: /c_tstz TIMESTAMPTZ/i,
        c_bool: /c_bool BOOLEAN/i,
        c_json: /c_json JSONB/i,
        c_uuid: /c_uuid UUID/i,
        c_bin: /c_bin BYTEA/i,
      },
      mssql: {
        c_int: /c_int INT(?!\w)/i,
        c_bigint: /c_bigint BIGINT/i,
        c_float: /c_float FLOAT(?!\()/i,
        c_double: /c_double FLOAT\(53\)/i,
        c_dec: /c_dec DECIMAL\(12,2\)/i,
        c_str: /c_str NVARCHAR\(100\)/i,
        c_vc: /c_vc NVARCHAR\(100\)/i,
        c_text: /c_text NVARCHAR\(MAX\)/i,
        c_date: /c_date DATE/i,
        c_time: /c_time TIME/i,
        c_dt: /c_dt DATETIME2/i,
        c_ts: /c_ts DATETIME2/i,
        c_tstz: /c_tstz DATETIMEOFFSET/i,
        c_bool: /c_bool BIT/i,
        c_json: /c_json NVARCHAR\(MAX\)/i,
        c_uuid: /c_uuid UNIQUEIDENTIFIER/i,
        c_bin: /c_bin VARBINARY\(MAX\)/i,
      },
    }

    for (const dialect of Object.keys(expectations)) {
      const ex = new Exec(dialect)
      setDefaultExecutor(ex as any)
      await resetMigrations({ executor: ex as any })
      await migrateUp([{ id: `${dialect}_all_types`, up: buildAllTypes() }], { executor: ex as any })
      const sql = (ex as any).getSeen().join('\n')
      const exp = expectations[dialect]
      for (const key of Object.keys(exp)) {
        expect(sql).toMatch(exp[key as keyof typeof exp])
      }
    }
  })

  it('ColumnDefault variants map correctly (NULL, booleans, numbers, strings, CURRENT_TIMESTAMP)', async () => {
    const buildWithDefaults = (v: any) => migration((b: MigrationBuilder) => {
      b.createTable('d', {
        a: { type: ColumnType.Int, default: v },
        b: { type: ColumnType.String, length: 10, default: v },
        c: { type: ColumnType.DateTime, default: v },
      })
    })
    const cases: Array<[
      any, // dialect
      Array<[any, RegExp[]]> // value, regexes
    ]> = [
      ['sqlite', [
        [null, [/DEFAULT NULL/i]],
        [true, [/DEFAULT 1(?!\d)/i]],
        [false, [/DEFAULT 0(?!\d)/i]],
        [123, [/DEFAULT 123(?!\d)/i]],
        ["O'Reilly", [/DEFAULT 'O''Reilly'/i]],
        [ColumnDefault.CurrentTimestamp, [/DEFAULT CURRENT_TIMESTAMP/i]],
      ]],
      ['mysql', [
        [ColumnDefault.CurrentTimestamp, [/DEFAULT CURRENT_TIMESTAMP/i]],
      ]],
      ['postgres', [
        [ColumnDefault.CurrentTimestamp, [/DEFAULT CURRENT_TIMESTAMP/i]],
      ]],
      ['mssql', [
        [ColumnDefault.CurrentTimestamp, [/DEFAULT GETDATE\(\)/i]],
      ]],
    ]
    for (const [dialect, vals] of cases) {
      const ex = new Exec(dialect)
      setDefaultExecutor(ex as any)
      await resetMigrations({ executor: ex as any })
      for (const [val, regs] of vals) {
        await migrateUp([{ id: `${dialect}_defaults_${String(val)}`.replace(/\W+/g,'_'), up: buildWithDefaults(val) }], { executor: ex as any })
        const sql = (ex as any).getSeen().join('\n')
        for (const r of regs) expect(sql).toMatch(r)
      }
    }
  })

  it('ColumnDefault.UuidV4 maps correctly per dialect', async () => {
    const spec = (id: string) => ({ id, up: migration((b: MigrationBuilder) => {
      b.createTable('u', {
        id: { type: ColumnType.Uuid, default: ColumnDefault.UuidV4 },
      })
    }) })
    const cases: Array<[any, RegExp]> = [
      ['sqlite', /DEFAULT NULL/i],
      ['mysql', /DEFAULT UUID\(\)/i],
      ['postgres', /DEFAULT gen_random_uuid\(\)/i],
      ['mssql', /DEFAULT NEWID\(\)/i],
      ['oracle', /DEFAULT LOWER\(RAWTOHEX\(SYS_GUID\(\)\)\)/i],
    ]
    for (const [dialect, pattern] of cases) {
      const ex = new Exec(dialect)
      setDefaultExecutor(ex as any)
      await resetMigrations({ executor: ex as any })
      await migrateUp([spec(`${dialect}_uuidv4`)], { executor: ex as any })
      const sql = (ex as any).getSeen().join('\n')
      expect(sql).toMatch(pattern)
    }
  })

  it('autoIncrement generates identity/auto syntax per dialect', async () => {
    const mkSpec = (id: string) => ({ id, up: migration((b: MigrationBuilder) => {
      b.createTable('ai', {
        id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true },
      })
    }) })
    const patterns: Array<[any, RegExp]> = [
      ['sqlite', /CREATE TABLE ai \(id INTEGER PRIMARY KEY AUTOINCREMENT\)/i],
      ['mysql', /CREATE TABLE ai \(id INT PRIMARY KEY AUTO_INCREMENT\)/i],
      ['postgres', /CREATE TABLE ai \(id INTEGER PRIMARY KEY GENERATED (ALWAYS|BY DEFAULT) AS IDENTITY\)/i],
      ['mssql', /CREATE TABLE ai \(id INT PRIMARY KEY IDENTITY\(1,1\)\)/i],
      ['oracle', /CREATE TABLE ai \(id NUMBER PRIMARY KEY GENERATED (ALWAYS|BY DEFAULT) AS IDENTITY\)/i],
    ]
    for (const [dialect, re] of patterns) {
      const ex = new Exec(dialect)
      setDefaultExecutor(ex as any)
      await resetMigrations({ executor: ex as any })
      await migrateUp([mkSpec(`${dialect}_ai`)], { executor: ex as any })
      const sql = (ex as any).getSeen().join('\n')
      expect(sql).toMatch(re)
    }
  })

  it('postgres autoIncrement: serial mode switches type to SERIAL/BIGSERIAL', async () => {
    const spec = (id: string) => ({ id, up: migration((b: MigrationBuilder) => {
      b.createTable('s', {
        a: { type: ColumnType.Int, primaryKey: true, autoIncrement: { mode: 'serial' } },
        b: { type: ColumnType.BigInt, primaryKey: false, autoIncrement: { mode: 'serial' } },
      })
    }) })
    const ex = new Exec('postgres')
    setDefaultExecutor(ex as any)
    await resetMigrations({ executor: ex as any })
    await migrateUp([spec('pg_serial')], { executor: ex as any })
    const sql = (ex as any).getSeen().join('\n')
    expect(sql).toMatch(/CREATE TABLE s \(a SERIAL PRIMARY KEY, b BIGSERIAL\)/i)
  })

  it('emits REFERENCES and createJoinTable with unique index', async () => {
    class ExecCapture implements DatabaseExecutor {
      private seen: string[] = []
      executeQuerySync?(sql: string, bindings: any[]): { data: any[] } { this.seen.push(sql); return { data: [] } }
      async executeQuery(sql: string, bindings: any[] = []) { this.seen.push(sql); return { data: [] } }
      runSync?(sql: string, bindings: any[]): any { this.seen.push(sql); return { changes: 1 } }
      getSeen() { return this.seen.join('\n') }
    }
    const ex = new ExecCapture()
    setDefaultExecutor(ex as any)
    await resetMigrations({ executor: ex as any })

    const up = migration((b: MigrationBuilder) => {
      b.createTable('posts', {
        id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true },
        user_id: { type: ColumnType.Int, notNull: true, references: { table: 'users', onDelete: 'CASCADE', onUpdate: 'CASCADE' } },
      })
       .createTable('tags', { id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true } })
       .createJoinTable('posts_tags', 'posts', 'tags', { cascade: true })
    })
    await migrateUp([{ id: 'refs_join', up }], { executor: ex as any })
    const sql = ex.getSeen()
    expect(sql).toMatch(/CREATE TABLE posts \(id .*?, user_id INT(.*?)REFERENCES users \(id\) ON DELETE CASCADE ON UPDATE CASCADE/i)
    expect(sql).toMatch(/CREATE TABLE tags \(id .*?\)/i)
    expect(sql).toMatch(/CREATE TABLE posts_tags \(/i)
    expect(sql).toMatch(/REFERENCES posts \(id\) ON DELETE CASCADE/i)
    expect(sql).toMatch(/REFERENCES tags \(id\) ON DELETE CASCADE/i)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS posts_tags_posts_id_tags_id_uniq ON posts_tags \(posts_id, tags_id\)/i)
  })
}) 