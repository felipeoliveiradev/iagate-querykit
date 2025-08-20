import type { MigrationContext, MigrationStep } from './migration-manager'

export enum ColumnType {
  Int = 'Int',
  BigInt = 'BigInt',
  Float = 'Float',
  Double = 'Double',
  Decimal = 'Decimal',
  String = 'String',
  Text = 'Text',
  Varchar = 'Varchar',
  Date = 'Date',
  Time = 'Time',
  DateTime = 'DateTime',
  Timestamp = 'Timestamp',
  TimestampTz = 'TimestampTz',
  Boolean = 'Boolean',
  Json = 'Json',
  Uuid = 'Uuid',
  Binary = 'Binary',
}
export enum ColumnDefault {
  CurrentTimestamp = 'CurrentTimestamp',
  UuidV4 = 'UuidV4',
}
export type ForeignKeyOptions = {
  table: string
  column?: string
  onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION'
  onUpdate?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION'
}
export type ColumnOptions = {
  primaryKey?: boolean
  notNull?: boolean
  unique?: boolean
  default?: string | number | boolean | null | ColumnDefault
  length?: number
  precision?: number
  scale?: number
  autoIncrement?: boolean | { mode?: 'always' | 'default' | 'serial'; start?: number; increment?: number }
  references?: ForeignKeyOptions
}

export class MigrationBuilder {
  private steps: ((ctx: MigrationContext) => Promise<void>)[] = []

  private typeFor(dialect: string | undefined, t: ColumnType, len?: number, prec?: number, scale?: number): string {
    switch (t) {
      case ColumnType.Int:
        switch (dialect) {
          case 'mysql': return 'INT'
          case 'postgres': return 'INTEGER'
          case 'mssql': return 'INT'
          case 'oracle': return 'NUMBER'
          default: return 'INTEGER'
        }
      case ColumnType.BigInt:
        switch (dialect) {
          case 'mysql': return 'BIGINT'
          case 'postgres': return 'BIGINT'
          case 'mssql': return 'BIGINT'
          case 'oracle': return 'NUMBER(19)'
          default: return 'BIGINT'
        }
      case ColumnType.Float:
        switch (dialect) {
          case 'mysql': return 'FLOAT'
          case 'postgres': return 'REAL'
          case 'mssql': return 'FLOAT'
          case 'oracle': return 'BINARY_FLOAT'
          default: return 'REAL'
        }
      case ColumnType.Double:
        switch (dialect) {
          case 'mysql': return 'DOUBLE'
          case 'postgres': return 'DOUBLE PRECISION'
          case 'mssql': return 'FLOAT(53)'
          case 'oracle': return 'BINARY_DOUBLE'
          default: return 'DOUBLE'
        }
      case ColumnType.Decimal: {
        const p = prec || 10; const s = scale || 2
        switch (dialect) {
          case 'mysql': return `DECIMAL(${p},${s})`
          case 'postgres': return `DECIMAL(${p},${s})`
          case 'mssql': return `DECIMAL(${p},${s})`
          case 'oracle': return `NUMBER(${p},${s})`
          default: return `NUMERIC(${p},${s})`
        }
      }
      case ColumnType.String:
      case ColumnType.Varchar: {
        const L = len || 255
        switch (dialect) {
          case 'mysql': return `VARCHAR(${L})`
          case 'postgres': return `VARCHAR(${L})`
          case 'mssql': return `NVARCHAR(${L})`
          case 'oracle': return `VARCHAR2(${L})`
          default: return `VARCHAR(${L})`
        }
      }
      case ColumnType.Text:
        switch (dialect) {
          case 'mysql': return 'TEXT'
          case 'postgres': return 'TEXT'
          case 'mssql': return 'NVARCHAR(MAX)'
          case 'oracle': return 'CLOB'
          default: return 'TEXT'
        }
      case ColumnType.Date:
        switch (dialect) {
          case 'mysql': return 'DATE'
          case 'postgres': return 'DATE'
          case 'mssql': return 'DATE'
          case 'oracle': return 'DATE'
          default: return 'DATE'
        }
      case ColumnType.Time:
        switch (dialect) {
          case 'mysql': return 'TIME'
          case 'postgres': return 'TIME'
          case 'mssql': return 'TIME'
          case 'oracle': return 'VARCHAR2(20)'
          default: return 'TEXT'
        }
      case ColumnType.DateTime:
      case ColumnType.Timestamp:
        switch (dialect) {
          case 'mysql': return 'DATETIME'
          case 'postgres': return 'TIMESTAMP'
          case 'mssql': return 'DATETIME2'
          case 'oracle': return 'TIMESTAMP'
          default: return 'DATETIME'
        }
      case ColumnType.TimestampTz:
        switch (dialect) {
          case 'mysql': return 'TIMESTAMP'
          case 'postgres': return 'TIMESTAMPTZ'
          case 'mssql': return 'DATETIMEOFFSET'
          case 'oracle': return 'TIMESTAMP WITH TIME ZONE'
          default: return 'DATETIME'
        }
      case ColumnType.Boolean:
        switch (dialect) {
          case 'mysql': return 'TINYINT(1)'
          case 'postgres': return 'BOOLEAN'
          case 'mssql': return 'BIT'
          case 'oracle': return 'NUMBER(1)'
          default: return 'INTEGER'
        }
      case ColumnType.Json:
        switch (dialect) {
          case 'mysql': return 'JSON'
          case 'postgres': return 'JSONB'
          case 'mssql': return 'NVARCHAR(MAX)'
          case 'oracle': return 'CLOB'
          default: return 'TEXT'
        }
      case ColumnType.Uuid:
        switch (dialect) {
          case 'postgres': return 'UUID'
          case 'mssql': return 'UNIQUEIDENTIFIER'
          case 'oracle': return 'VARCHAR2(36)'
          default: return 'CHAR(36)'
        }
      case ColumnType.Binary:
        switch (dialect) {
          case 'mysql': return 'BLOB'
          case 'postgres': return 'BYTEA'
          case 'mssql': return 'VARBINARY(MAX)'
          case 'oracle': return 'BLOB'
          default: return 'BLOB'
        }
      default:
        return 'TEXT'
    }
  }

  private defaultFor(dialect: string | undefined, t: ColumnType, v: NonNullable<ColumnOptions['default']>): string {
    const wantsCurrentTs = v === ColumnDefault.CurrentTimestamp || (typeof v === 'string' && v.toUpperCase() === 'CURRENT_TIMESTAMP')
    if (wantsCurrentTs) {
      switch (dialect) {
        case 'mssql': return 'GETDATE()'
        case 'oracle': return 'CURRENT_TIMESTAMP'
        default: return 'CURRENT_TIMESTAMP'
      }
    }
    if (v === ColumnDefault.UuidV4) {
      switch (dialect) {
        case 'mysql': return 'UUID()'
        case 'postgres': return 'gen_random_uuid()'
        case 'mssql': return 'NEWID()'
        case 'oracle': return 'LOWER(RAWTOHEX(SYS_GUID()))'
        default: return 'NULL'
      }
    }
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
    if (v === null) return 'NULL'
    if (typeof v === 'boolean') return v ? '1' : '0'
    return String(v)
  }

  private colDef(dialect: string | undefined, name: string, type: ColumnType, opts: ColumnOptions = {}): string {
    const parts: string[] = [name, this.typeFor(dialect, type, opts.length, opts.precision, opts.scale)]
    if (opts.primaryKey) parts.push('PRIMARY KEY')
    if (opts.notNull) parts.push('NOT NULL')
    if (opts.unique) parts.push('UNIQUE')

    // auto-increment / identity
    if (opts.autoIncrement) {
      const ai = typeof opts.autoIncrement === 'object' ? opts.autoIncrement : {}
      const mode = (ai as any).mode as ('always' | 'default' | 'serial' | undefined)
      const start = (ai as any).start ?? 1
      const step = (ai as any).increment ?? 1
      switch (dialect) {
        case 'mysql':
          parts.push('AUTO_INCREMENT')
          break
        case 'postgres': {
          if (mode === 'serial') {
            if (type === ColumnType.BigInt) parts[1] = 'BIGSERIAL'
            else parts[1] = 'SERIAL'
          } else {
            const m = mode === 'always' ? 'ALWAYS' : 'BY DEFAULT'
            parts.push(`GENERATED ${m} AS IDENTITY`)
          }
          break
        }
        case 'mssql':
          parts.push(`IDENTITY(${start},${step})`)
          break
        case 'oracle': {
          const m = mode === 'always' ? 'ALWAYS' : 'BY DEFAULT'
          parts.push(`GENERATED ${m} AS IDENTITY`)
          break
        }
        default: { // sqlite
          const alreadyPk = parts.some(p => /PRIMARY KEY/i.test(p))
          const baseType = parts[1] || ''
          if (!alreadyPk) parts.push('PRIMARY KEY')
          if (/^INTEGER\b/i.test(baseType)) parts.push('AUTOINCREMENT')
          break
        }
      }
    }

    if (opts.default !== undefined) {
      const dv = this.defaultFor(dialect, type, opts.default as any)
      parts.push('DEFAULT ' + dv)
    }

    if (opts.references) {
      const refCol = opts.references.column || 'id'
      let ref = `REFERENCES ${opts.references.table} (${refCol})`
      if (opts.references.onDelete) ref += ` ON DELETE ${opts.references.onDelete}`
      if (opts.references.onUpdate) ref += ` ON UPDATE ${opts.references.onUpdate}`
      parts.push(ref)
    }

    return parts.join(' ')
  }

  createTable(name: string, columns: Record<string, { type: ColumnType } & ColumnOptions>): this {
    this.steps.push(async (ctx) => {
      const cols = Object.entries(columns).map(([n, def]) => this.colDef(ctx.dialect, n, def.type, def))
      const sql = `CREATE TABLE ${name} (${cols.join(', ')})`
      await ctx.query(sql)
    })
    return this
  }

  dropTable(name: string): this {
    this.steps.push(async (ctx) => { await ctx.query(`DROP TABLE IF EXISTS ${name}`) })
    return this
  }

  addColumn(table: string, column: string, def: { type: ColumnType } & ColumnOptions): this {
    this.steps.push(async (ctx) => {
      const sql = `ALTER TABLE ${table} ADD COLUMN ${this.colDef(ctx.dialect, column, def.type, def)}`
      await ctx.query(sql)
    })
    return this
  }

  dropColumn(table: string, column: string): this {
    this.steps.push(async (ctx) => {
      await ctx.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    })
    return this
  }

  renameColumn(table: string, from: string, to: string): this {
    this.steps.push(async (ctx) => {
      await ctx.query(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`)
    })
    return this
  }

  createIndex(table: string, columns: string[], opts: { unique?: boolean; name?: string } = {}): this {
    this.steps.push(async (ctx) => {
      const name = opts.name || `${table}_${columns.join('_')}_idx`
      const uniq = opts.unique ? 'UNIQUE ' : ''
      const sql = `CREATE ${uniq}INDEX IF NOT EXISTS ${name} ON ${table} (${columns.join(', ')})`
      await ctx.query(sql)
    })
    return this
  }

  dropIndex(name: string): this {
    this.steps.push(async (ctx) => { await ctx.query(`DROP INDEX IF EXISTS ${name}`) })
    return this
  }

  createJoinTable(name: string, leftTable: string, rightTable: string, opts: { cascade?: boolean; leftKeyName?: string; rightKeyName?: string } = {}): this {
    this.steps.push(async (ctx) => {
      const leftCol = opts.leftKeyName || `${leftTable}_id`
      const rightCol = opts.rightKeyName || `${rightTable}_id`
      const on = opts.cascade ? 'CASCADE' : undefined
      const cols = [
        this.colDef(ctx.dialect, leftCol, ColumnType.Int, { notNull: true, references: { table: leftTable, onDelete: on } }),
        this.colDef(ctx.dialect, rightCol, ColumnType.Int, { notNull: true, references: { table: rightTable, onDelete: on } }),
      ]
      const sql = `CREATE TABLE ${name} (${cols.join(', ')})`
      await ctx.query(sql)
      // composite unique to avoid duplicates
      const idxName = `${name}_${leftCol}_${rightCol}_uniq`
      await ctx.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${idxName} ON ${name} (${leftCol}, ${rightCol})`)
    })
    return this
  }

  raw(sql: string): this {
    this.steps.push(async (ctx) => { await ctx.query(sql) })
    return this
  }

  async apply(ctx: MigrationContext): Promise<void> {
    for (const s of this.steps) await s(ctx)
  }
}

export function migration(dsl: (b: MigrationBuilder) => void): MigrationStep {
  return async (ctx) => {
    const b = new MigrationBuilder()
    dsl(b)
    await b.apply(ctx)
  }
} 