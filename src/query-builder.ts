import { QueryKitConfig, getExecutorForTable } from './config';
import { raw } from './raw';
import { simulationManager } from './simulation-manager';
import { eventManager } from './event-manager';

export type Operator = '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'BETWEEN' | 'NOT BETWEEN' | 'IS NULL' | 'IS NOT NULL';

type WhereClause<T = any> = {
  type: 'basic' | 'raw' | 'column' | 'in' | 'null' | 'between' | 'exists';
  column?: keyof T | string;
  operator?: Operator;
  value?: any;
  sql?: string;
  query?: QueryBuilder<any>;
  logical: 'AND' | 'OR';
  not?: boolean;
};

type Aggregate = { func: 'count' | 'sum' | 'avg' | 'min' | 'max'; column: string; alias?: string };

type MemoryLimitOptions = { bytes: number; strategy?: 'chunk' | 'stream' | 'paginate'; onLimitReached?: (currentUsage: number, limit: number) => void };

export class QueryBuilder<T extends { id?: any } & Record<string, any>> {
  private tableName: string;
  private whereClauses: WhereClause<T>[] = [];
  private orWhereClauses: WhereClause<T>[] = [];
  private joins: { type: 'INNER' | 'LEFT' | 'RIGHT'; table: string; on: string }[] = [];
  private selectColumns: (keyof T | string | any)[] = ['*'];
  private orderClauses: { column: string; direction: 'ASC' | 'DESC' }[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private groupByColumns: string[] = [];
  private havingClauses: WhereClause<T>[] = [];
  private isDistinct = false;
  private pendingAction?: { type: string; data?: any; attributes?: any };
  private aggregates: Aggregate[] = [];
  private tableAlias?: string;
  private unionParts: { type: 'UNION' | 'UNION ALL'; query: QueryBuilder<any> }[] = [];
  private targetBanks?: string[];

  private isTracking: boolean = false;
  private isSeeding: boolean = false;
  private trackingLogs: { step: string; details: any; timestamp: Date }[] = [];
  private virtualTable: T[] = [];

  constructor(tableName: string) { this.tableName = tableName; }

  bank(bankOrBanks: string | string[]): this {
    this.targetBanks = Array.isArray(bankOrBanks) ? bankOrBanks : [bankOrBanks];
    return this;
  }

  public hasPendingWrite(): boolean {
    return !!this.pendingAction && ['insert','update','delete','updateOrInsert','increment','decrement'].includes(this.pendingAction.type);
  }

  private track(step: string, details: any = {}) {
    if (this.isTracking || simulationManager.isActive()) this.trackingLogs.push({ step, details, timestamp: new Date() });
  }

  async initial(data?: T[]): Promise<this> {
    this.isTracking = true;
    this.trackingLogs = [];
    if (data) {
      this.virtualTable = JSON.parse(JSON.stringify(data));
      this.track('tracking.initialized', { source: 'manual', count: data.length });
    } else {
      this.track('tracking.seeding_from_db', { query: this.toSql() });
      this.isSeeding = true;
      try {
        const results = await this.all<T>();
        this.virtualTable = results;
        this.track('tracking.initialized', { source: 'database', table: this.tableName, count: results.length });
      } finally {
        this.isSeeding = false;
      }
    }
    return this;
  }

  tracking(): { step: string; details: any; timestamp: Date }[] {
    if (!this.isTracking) return [{ step: 'error', details: 'Tracking was not enabled. Call .initial() before .tracking().', timestamp: new Date() }];
    if (this.pendingAction) {
      this.track('virtual_execution.start', this.pendingAction);
      this.executeVirtualAction();
      this.track('virtual_execution.end', { finalVirtualTableState: this.virtualTable });
      this.pendingAction = undefined;
    } else {
      this.track('dry_run_select.summary', this.toSql());
    }
    return this.trackingLogs;
  }

  private applyWhereClausesToVirtual(data: T[]): T[] {
    if (this.whereClauses.length === 0) return data;
    return data.filter(row => this.whereClauses.every(clause => {
      if (clause.type === 'basic' && clause.operator === '=') return row[clause.column as keyof T] === clause.value;
      return true;
    }));
  }

  private executeVirtualAction(): void {
    if (!this.pendingAction) return;
    const { type, data } = this.pendingAction;
    switch (type) {
      case 'insert': this.virtualTable.push(...data); break;
      case 'update': {
        const rowsToUpdate = this.applyWhereClausesToVirtual(this.virtualTable);
        rowsToUpdate.forEach(row => Object.assign(row, data));
        break;
      }
      case 'delete': {
        const rowsToDelete = this.applyWhereClausesToVirtual(this.virtualTable);
        const idsToDelete = new Set(rowsToDelete.map(r => r.id));
        this.virtualTable = this.virtualTable.filter(row => !idsToDelete.has(row.id));
        break;
      }
    }
    if (simulationManager.isActive()) simulationManager.updateStateFor(this.tableName, this.virtualTable);
  }

  select(columns: (keyof T | string)[] = ['*']): this { this.track('select', { columns }); this.selectColumns = columns.map(c => String(c)); return this; }
  selectRaw(sql: string): this { this.track('selectRaw', { sql }); this.selectColumns.push(raw(sql)); return this; }
  aggregatesSelect(columns: string[]): this { this.track('aggregatesSelect', { columns }); columns.forEach(c => this.selectColumns.push(c)); return this; }
  distinct(): this { this.track('distinct'); this.isDistinct = true; return this; }

  where(column: keyof T | string, operator: Operator, value: any): this { this.track('where', { column, operator, value }); this.whereClauses.push({ type: 'basic', column, operator, value, logical: 'AND' }); return this; }
  orWhere(column: keyof T | string, operator: Operator, value: any): this { this.track('orWhere', { column, operator, value }); this.orWhereClauses.push({ type: 'basic', column, operator, value, logical: 'OR' }); return this; }
  whereIf(condition: any, column: keyof T | string, operator: Operator, value: any): this { if (condition !== null && condition !== undefined && condition !== '') this.where(column, operator, value); return this; }
  whereAll(conditions: Partial<T>): this { for (const key in conditions) { const value = (conditions as any)[key]; this.whereIf(value, key, '=', value); } return this; }

  insert(data: Partial<T> | Partial<T>[]): this { this.track('insert', { data }); const dataAsArray = Array.isArray(data) ? data : [data]; this.pendingAction = { type: 'insert', data: dataAsArray }; return this; }
  update(data: Partial<T>): this { this.track('update', { data }); this.pendingAction = { type: 'update', data }; return this; }
  delete(): this { this.track('delete'); this.pendingAction = { type: 'delete' }; return this; }
  updateOrInsert(attributes: Partial<T>, values: Partial<T> = {}): this { this.pendingAction = { type: 'updateOrInsert', data: { attributes, values } }; return this; }
  increment(column: keyof T, amount = 1): this { this.pendingAction = { type: 'increment', data: { column, amount } }; return this; }
  decrement(column: keyof T, amount = 1): this { this.pendingAction = { type: 'decrement', data: { column, amount } }; return this; }

  whereIn(column: keyof T | string, values: any[], logical: 'AND' | 'OR' = 'AND'): this { this.whereClauses.push({ type: 'in', column, value: values, logical, not: false }); return this; }
  orWhereIn(column: keyof T | string, values: any[]): this { return this.whereIn(column, values, 'OR'); }
  whereNotIn(column: keyof T | string, values: any[]): this { this.whereClauses.push({ type: 'in', column, value: values, logical: 'AND', not: true }); return this; }
  orWhereNotIn(column: keyof T | string, values: any[]): this { this.orWhereClauses.push({ type: 'in', column, value: values, logical: 'OR', not: true }); return this; }
  whereNull(column: keyof T | string): this { this.whereClauses.push({ type: 'null', column, logical: 'AND', not: false, value: undefined }); return this; }
  orWhereNull(column: keyof T | string): this { this.orWhereClauses.push({ type: 'null', column, logical: 'OR', not: false, value: undefined }); return this; }
  whereNotNull(column: keyof T | string): this { this.whereClauses.push({ type: 'null', column, logical: 'AND', not: true, value: undefined }); return this; }
  orWhereNotNull(column: keyof T | string): this { this.orWhereClauses.push({ type: 'null', column, logical: 'OR', not: true, value: undefined }); return this; }
  whereBetween(column: keyof T | string, values: [any, any]): this { this.whereClauses.push({ type: 'between', column, value: values, logical: 'AND', not: false }); return this; }
  whereNotBetween(column: keyof T | string, values: [any, any]): this { this.whereClauses.push({ type: 'between', column, value: values, logical: 'AND', not: true }); return this; }
  whereColumn(firstColumn: keyof T | string, operator: Operator, secondColumn: keyof T | string, logical: 'AND' | 'OR' = 'AND'): this { this.whereClauses.push({ type: 'column', column: firstColumn, operator, value: secondColumn, logical }); return this; }
  whereRaw(sql: string, bindings: any[] = [], logical: 'AND' | 'OR' = 'AND'): this { this.havingClauses.push({ type: 'raw', sql, logical } as any); return this; }
  whereRawSearch(searchTerm: string, columns: (keyof T | string)[]): this { if (!searchTerm) return this; const searchConditions = columns.map(col => `${String(col)} LIKE ?`).join(' OR '); const bindings = columns.map(() => `%${searchTerm}%`); return this.whereRaw(`(${searchConditions})`, bindings); }
  whereExists(query: QueryBuilder<any>): this { this.whereClauses.push({ type: 'exists', query, logical: 'AND', not: false, value: undefined }); return this; }
  whereNotExists(query: QueryBuilder<any>): this { this.whereClauses.push({ type: 'exists', query, logical: 'AND', not: true, value: undefined }); return this; }

  when(condition: any, callback: (query: this, value: any) => void): this { if (condition) callback(this, condition); return this; }
  unless(condition: any, callback: (query: this, value: any) => void): this { if (!condition) callback(this, condition); return this; }
  clone(): this { const newQuery = new (this.constructor as any)(this.tableName); Object.assign(newQuery, { ...this, selectColumns: [...this.selectColumns], whereClauses: [...this.whereClauses], orWhereClauses: [...this.orWhereClauses], joins: [...this.joins], orderClauses: [...this.orderClauses], groupByColumns: [...this.groupByColumns], havingClauses: [...this.havingClauses], aggregates: [...this.aggregates], }); return newQuery; }

  orderBy(column: keyof T | string, direction: 'ASC' | 'DESC' = 'ASC'): this { this.orderClauses.push({ column: String(column), direction }); return this; }
  orderByMany(orders: { column: string; direction?: 'ASC' | 'DESC' }[]): this { orders.forEach(o => this.orderBy(o.column, o.direction || 'ASC')); return this; }
  limit(count: number): this { this.limitValue = count; return this; }
  offset(count: number): this { this.offsetValue = count; return this; }

  innerJoin(targetTable: string, on: string): this { this.joins.push({ type: 'INNER', table: targetTable, on }); return this; }
  leftJoin(targetTable: string, on: string): this { this.joins.push({ type: 'LEFT', table: targetTable, on }); return this; }
  rightJoin(targetTable: string, on: string): this { this.joins.push({ type: 'RIGHT', table: targetTable, on }); return this; }
  innerJoinOn(targetTable: string, left: string, right: string): this { return this.innerJoin(targetTable, `${left} = ${right}`); }
  leftJoinOn(targetTable: string, left: string, right: string): this { return this.leftJoin(targetTable, `${left} = ${right}`); }
  rightJoinOn(targetTable: string, left: string, right: string): this { return this.rightJoin(targetTable, `${left} = ${right}`); }
  groupBy(columns: (keyof T | string)[]): this { this.groupByColumns = columns.map(c => String(c)); return this; }
  having(column: keyof T | string, op: Operator, value: any): this { this.havingClauses.push({ type: 'basic', column, operator: op, value, logical: 'AND' }); return this; }
  havingRaw(sql: string, bindings: any[] = [], logical: 'AND' | 'OR' = 'AND'): this { this.havingClauses.push({ type: 'raw', sql, logical } as any); return this; }
  havingIf(condition: any, column: keyof T | string, op: Operator, value: any): this { if (condition !== null && condition !== undefined && condition !== '') return this.having(column as any, op, value); return this; }

  public toSql(): { sql: string; bindings: any[] } {
    if (this.aggregates.length > 0) {
      const agg = this.aggregates[0];
      this.selectColumns = [raw(`${agg.func}(${agg.column}) as ${agg.alias || 'aggregate'}`)];
    }
    let baseSelect = `SELECT ${this.isDistinct ? 'DISTINCT' : ''} ${this.selectColumns.map(c => (c && typeof c === 'object' && 'toSQL' in c) ? (c as any).toSQL() : String(c)).join(', ')} FROM ${this.tableName}${this.tableAlias ? ' ' + this.tableAlias : ''}`;
    const params: any[] = [];
    if (this.joins.length > 0) baseSelect += ' ' + this.joins.map(j => `${j.type} JOIN ${j.table} ON ${j.on}`).join(' ');
    const whereClause = this.buildWhereClause(this.whereClauses, params, 'AND');
    if (whereClause) baseSelect += ` WHERE ${whereClause}`;
    if (this.groupByColumns.length > 0) baseSelect += ` GROUP BY ${this.groupByColumns.join(', ')}`;
    if (this.havingClauses.length > 0) {
      const havingClause = this.buildWhereClause(this.havingClauses as any, params, 'AND');
      if (havingClause) baseSelect += ` HAVING ${havingClause}`;
    }
    if (this.orderClauses.length > 0) baseSelect += ` ORDER BY ${this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ')}`;
    if (typeof this.limitValue === 'number') { baseSelect += ` LIMIT ?`; params.push(this.limitValue); }
    if (typeof this.offsetValue === 'number') { baseSelect += ` OFFSET ?`; params.push(this.offsetValue); }
    if (this.unionParts.length > 0) {
      let sql = `(${baseSelect})`;
      for (const part of this.unionParts) { const { sql: subSql, bindings: subBindings } = part.query.toSql(); sql += ` ${part.type} (${subSql})`; params.push(...subBindings); }
      return { sql, bindings: params };
    }
    return { sql: baseSelect, bindings: params };
  }

  private buildWhereClause(clauses: WhereClause<T>[], params: any[], def: 'AND' | 'OR'): string {
    if (clauses.length === 0) return '';
    return clauses.map((clause, index) => {
      let conditionStr: string;
      switch (clause.type) {
        case 'basic': params.push(clause.value); conditionStr = `${String(clause.column)} ${clause.operator} ?`; break;
        case 'column': conditionStr = `${String(clause.column)} ${clause.operator} ${String(clause.value)}`; break;
        case 'raw': conditionStr = clause.sql!; break;
        case 'in': if (!Array.isArray(clause.value) || clause.value.length === 0) { conditionStr = clause.not ? '1=1' : '1=0'; } else { params.push(...clause.value); const placeholders = clause.value.map(() => '?').join(','); conditionStr = `${String(clause.column)} ${clause.not ? 'NOT IN' : 'IN'} (${placeholders})`; } break;
        case 'null': conditionStr = `${String(clause.column)} IS ${clause.not ? 'NOT ' : ''}NULL`; break;
        case 'between': params.push(...clause.value); conditionStr = `${String(clause.column)} ${clause.not ? 'NOT BETWEEN' : 'BETWEEN'} ? AND ?`; break;
        case 'exists': const { sql, bindings } = clause.query!.toSql(); params.push(...bindings); conditionStr = `${clause.not ? 'NOT ' : ''}EXISTS (${sql})`; break;
        default: throw new Error('Unsupported where clause type');
      }
      const logical = index > 0 ? clause.logical || def : '';
      return `${logical} ${conditionStr}`;
    }).join(' ').trim();
  }

  get<U = T>(): U | undefined { this.limit(1); const rows = this.allSync<U>(); return rows[0]; }
  first<U = T>(): U | undefined { return this.get<U>(); }
  find(id: string | number): T | undefined { return this.where('id' as any, '=', id).get(); }

  async exists(): Promise<boolean> { const q = this.selectRaw('1').limit(1); const row = await q.all<any>(); return !!(row && row.length); }
  async pluck(column: keyof T): Promise<any[]> { const results = await this.select([column]).all(); return results.map(r => r[column]); }

  async all<U = T>(): Promise<U[]> {
    this.track('all');
    if (simulationManager.isActive()) {
      const virtualData = simulationManager.getStateFor(this.tableName);
      if (virtualData) {
        this.virtualTable = JSON.parse(JSON.stringify(virtualData));
        let results = this.applyWhereClausesToVirtual(this.virtualTable) as unknown as U[];
        const offset = this.offsetValue || 0;
        const limit = this.limitValue === undefined ? results.length : this.limitValue;
        return results.slice(offset, offset + limit);
      }
      return [];
    }
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    const { sql, bindings } = this.toSql();
    eventManager.emit(`querykit:trigger:BEFORE:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'BEFORE', where: undefined } as any);
    const res = await exec.executeQuery(sql, bindings);
    const rows = res.data as U[];
    eventManager.emit(`querykit:trigger:AFTER:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'AFTER', rows } as any);
    return rows;
  }

  run(): any { const exec = QueryKitConfig.defaultExecutor; if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit'); const { sql, bindings } = this.toSql(); return exec.runSync(sql, bindings); }
  allSync<U = T>(): U[] {
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const { sql, bindings } = this.toSql();
    eventManager.emit(`querykit:trigger:BEFORE:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'BEFORE', where: undefined } as any);
    const out = exec.executeQuerySync(sql, bindings).data as U[];
    eventManager.emit(`querykit:trigger:AFTER:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'AFTER', rows: out } as any);
    return out;
  }
  getSync<U = T>(): U | undefined { this.limit(1); return this.allSync<U>()[0]; }
  firstSync<U = T>(): U | undefined { this.limit(1); return this.getSync<U>(); }
  pluckSync(column: keyof T | string): any[] { const rows = this.select([String(column)]).allSync<any>(); return rows.map(r => (r as any)[String(column)]); }
  scalarSync<U = any>(alias?: string): U | undefined { const row: any = this.getSync<any>(); if (!row) return undefined; if (alias && row[alias] !== undefined) return row[alias]; const k = Object.keys(row)[0]; return row[k] as U; }

  count(column: string = '*', alias?: string): this { return this.addAggregate('count', column, alias); }
  sum(column: string, alias?: string): this { return this.addAggregate('sum', column, alias); }
  avg(column: string, alias?: string): this { return this.addAggregate('avg', column, alias); }
  min(column: string, alias?: string): this { return this.addAggregate('min', column, alias); }
  max(column: string, alias?: string): this { return this.addAggregate('max', column, alias); }
  private addAggregate(func: Aggregate['func'], column: string, alias?: string) { this.aggregates.push({ func, column, alias: alias || `${func}_${column}` }); return this; }

  selectExpression(expression: string, alias?: string): this { const expr = alias ? `${expression} AS ${alias}` : expression; this.selectColumns.push(raw(expr)); return this; }
  selectCount(column: string = '*', alias: string = 'count'): this { return this.selectExpression(`COUNT(${column})`, alias); }
  selectSum(column: string, alias: string = 'sum'): this { return this.selectExpression(`SUM(${column})`, alias); }
  selectAvg(column: string, alias: string = 'avg'): this { return this.selectExpression(`AVG(${column})`, alias); }
  selectMin(column: string, alias: string = 'min'): this { return this.selectExpression(`MIN(${column})`, alias); }
  selectMax(column: string, alias: string = 'max'): this { return this.selectExpression(`MAX(${column})`, alias); }
  selectCaseSum(conditionSql: string, alias: string): this { return this.selectExpression(`SUM(CASE WHEN ${conditionSql} THEN 1 ELSE 0 END)`, alias); }
  groupByOne(column: keyof T | string): this { return this.groupBy([String(column)]); }
  paginate(page: number = 1, perPage: number = 25): this { const safePage = Math.max(1, page || 1); const safePerPage = Math.max(1, perPage || 25); this.limit(safePerPage); this.offset((safePage - 1) * safePerPage); return this; }
  range(field: keyof T | string, start?: Date, end?: Date): this { if (start) this.whereRaw(`${String(field)} >= ?`, [start.toISOString()]); if (end) this.whereRaw(`${String(field)} <= ?`, [end.toISOString()]); return this; }
  period(field: keyof T | string, periodKey?: '24h' | '7d' | '30d' | string): this { if (!periodKey) return this; const now = new Date(); let startDate: Date; switch (periodKey) { case '24h': startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); break; case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break; case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break; default: startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); } return this.whereRaw(`${String(field)} >= ?`, [startDate.toISOString()]); }

  whereLike(column: keyof T | string, pattern: string): this { return this.where(column as any, 'LIKE', pattern); }
  orWhereLike(column: keyof T | string, pattern: string): this { return this.orWhere(column as any, 'LIKE', pattern); }
  whereContains(column: keyof T | string, term: string): this { return this.whereLike(column, `%${term}%`); }
  whereStartsWith(column: keyof T | string, prefix: string): this { return this.whereLike(column, `${prefix}%`); }
  whereEndsWith(column: keyof T | string, suffix: string): this { return this.whereLike(column, `%${suffix}`); }
  whereILike(column: keyof T | string, pattern: string): this { return this.whereRaw(`${String(column)} LIKE ? COLLATE NOCASE`, [pattern]); }
  whereContainsCI(column: keyof T | string, term: string): this { return this.whereILike(column, `%${term}%`); }
  whereStartsWithCI(column: keyof T | string, prefix: string): this { return this.whereILike(column, `${prefix}%`); }
  whereEndsWithCI(column: keyof T | string, suffix: string): this { return this.whereILike(column, `%${suffix}`); }
  whereSearch(searchTerm: string, columns: (keyof T | string)[]): this { return this.whereRawSearch(searchTerm, columns as any); }

  union(query: QueryBuilder<any>): this { this.unionParts.push({ type: 'UNION', query }); return this; }
  unionAll(query: QueryBuilder<any>): this { this.unionParts.push({ type: 'UNION ALL', query }); return this; }

  async make(): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (!this.pendingAction) throw new Error('No pending write action to execute. Call insert(), update(), or delete() before .make()');
    const { type, data } = this.pendingAction;

    const mapAsyncResult = (raw: any): { changes: number; lastInsertRowid: number | bigint } => {
      if (Array.isArray(raw)) {
        const info = raw[1] || {};
        const changes = info.affectedRows ?? info.changes ?? 0;
        const lastId = info.insertId ?? info.lastInsertId ?? info.lastInsertRowid ?? 0;
        return { changes, lastInsertRowid: lastId };
      }
      const changes = raw?.affectedRows ?? raw?.changes ?? 0;
      const lastId = raw?.lastInsertId ?? raw?.lastInsertRowid ?? 0;
      return { changes, lastInsertRowid: lastId };
    };

    switch (type) {
      case 'insert': {
        const obj = Array.isArray(data) ? data[0] : data;
        const columns = Object.keys(obj);
        const values = Object.values(obj);
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        eventManager.emit(`querykit:trigger:BEFORE:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'BEFORE', data: obj, where: undefined } as any);
        const res = exec.runSync ? exec.runSync(sql, values) : await exec.executeQuery(sql, values);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'AFTER', data: obj, result: mapped } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'update': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const setClauses = Object.keys(data).map(k => `${k} = ?`).join(', ');
        const params = Object.values(data);
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data, where: { sql: where, bindings: params } } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data, where: { sql: where, bindings: params }, result: mapped } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'delete': {
        if (this.whereClauses.length === 0) throw new Error('Delete operations must have a WHERE clause.');
        const params: any[] = [];
        const where = this.buildWhereClause(this.whereClauses, params, 'AND');
        const sql = `DELETE FROM ${this.tableName} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:DELETE:${this.tableName}`, { table: this.tableName, action: 'DELETE', timing: 'BEFORE', where: { sql: where, bindings: params } } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:DELETE:${this.tableName}`, { table: this.tableName, action: 'DELETE', timing: 'AFTER', where: { sql: where, bindings: params }, result: mapped } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'increment': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const { column, amount } = data as { column: string; amount: number };
        const params: any[] = [amount ?? 1];
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${column} = ${column} + ? WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: { column, amount }, where: { sql: where, bindings: params } } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: { column, amount }, where: { sql: where, bindings: params }, result: mapped } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'decrement': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const { column, amount } = data as { column: string; amount: number };
        const params: any[] = [amount ?? 1];
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${column} = ${column} - ? WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: { column, amount }, where: { sql: where, bindings: params } } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: { column, amount }, where: { sql: where, bindings: params }, result: mapped } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'updateOrInsert': {
        const { attributes, values } = data as { attributes: Record<string, any>; values: Record<string, any> };
        // Attempt update
        const setClauses = Object.keys(values).map(k => `${k} = ?`).join(', ');
        const params = Object.values(values);
        // Build where from attributes, ensuring params appended for where after values
        const whereClausesBackup = [...this.whereClauses];
        this.whereClauses = [];
        Object.entries(attributes).forEach(([k, v]) => this.where(k, '=', v));
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sqlUpd = `UPDATE ${this.tableName} SET ${setClauses} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: values, where: { sql: where, bindings: params } } as any);
        const resUpd = exec.runSync ? exec.runSync(sqlUpd, params) : await exec.executeQuery(sqlUpd, params);
        const mappedUpd = exec.runSync ? resUpd : mapAsyncResult(resUpd);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: values, where: { sql: where, bindings: params }, result: mappedUpd } as any);
        let result = mappedUpd;
        if (!mappedUpd.changes) {
          // Perform insert with merged attributes+values
          const insertObj = { ...attributes, ...values };
          const columns = Object.keys(insertObj);
          const vals = Object.values(insertObj);
          const placeholders = columns.map(() => '?').join(', ');
          const sqlIns = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
          eventManager.emit(`querykit:trigger:BEFORE:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'BEFORE', data: insertObj, where: undefined } as any);
          const resIns = exec.runSync ? exec.runSync(sqlIns, vals) : await exec.executeQuery(sqlIns, vals);
          const mappedIns = exec.runSync ? resIns : mapAsyncResult(resIns);
          eventManager.emit(`querykit:trigger:AFTER:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'AFTER', data: insertObj, result: mappedIns } as any);
          result = mappedIns;
        }
        // restore whereClauses
        this.whereClauses = whereClausesBackup;
        this.pendingAction = undefined;
        return result;
      }
      default:
        throw new Error(`Unsupported pending action: ${type}`);
    }
  }
} 