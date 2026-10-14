import type { SqlDialect } from './dialect.js';
import { applyPaging } from './dialect.js';
import { quoteIdent, quoteSelectItem, quoteTableRef } from './identifiers.js';
import { normalizeBinding } from './bindings.js';

export type CompileWhereType = 'basic' | 'raw' | 'column' | 'in' | 'null' | 'between' | 'exists';

export type CompileWhereClause = {
  type: CompileWhereType;
  column?: string;
  operator?: string;
  value?: unknown;
  sql?: string;
  query?: { toSql(): { sql: string; bindings: unknown[] } };
  logical: 'AND' | 'OR';
  not?: boolean;
};

export type CompileJoin = { type: 'INNER' | 'LEFT' | 'RIGHT'; table: string; on: string };

export type CompileAggregate = { func: string; column: string; alias?: string };

export type CompileUnionPart = {
  type: string;
  query: { toSql(): { sql: string; bindings: unknown[] } };
};

export type CompileState = {
  tableName: string;
  tableAlias?: string;
  selectColumns: unknown[];
  selectBindings?: unknown[];
  aggregates: CompileAggregate[];
  isDistinct: boolean;
  joins: CompileJoin[];
  whereClauses: CompileWhereClause[];
  orWhereClauses: CompileWhereClause[];
  groupByColumns: string[];
  havingClauses: CompileWhereClause[];
  orderClauses: { column: string; direction: 'ASC' | 'DESC' }[];
  limitValue?: number;
  offsetValue?: number;
  unionParts: CompileUnionPart[];
};

function formatRawBindings(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

function isRaw(item: unknown): item is { toSQL(): string } {
  return !!item && typeof item === 'object' && typeof (item as { toSQL?: unknown }).toSQL === 'function';
}

function qSelect(item: unknown, dialect: SqlDialect): string {
  if (isRaw(item)) return item.toSQL();
  return quoteSelectItem(String(item), dialect);
}

export function compileWhere(
  clauses: CompileWhereClause[],
  dialect: SqlDialect,
  params: unknown[],
  def: 'AND' | 'OR',
): string {
  if (clauses.length === 0) return '';
  return clauses
    .map((clause, index) => {
      let conditionStr: string;
      switch (clause.type) {
        case 'basic':
          params.push(normalizeBinding(clause.value));
          conditionStr = `${quoteIdent(String(clause.column), dialect)} ${clause.operator} ?`;
          break;
        case 'column':
          conditionStr = `${quoteIdent(String(clause.column), dialect)} ${clause.operator} ${quoteIdent(String(clause.value), dialect)}`;
          break;
        case 'raw':
          params.push(...formatRawBindings(clause.value).map(normalizeBinding));
          conditionStr = clause.sql!;
          break;
        case 'in':
          if (!Array.isArray(clause.value) || clause.value.length === 0) {
            conditionStr = clause.not ? '1=1' : '1=0';
          } else {
            params.push(...clause.value.map(normalizeBinding));
            const placeholders = clause.value.map(() => '?').join(', ');
            conditionStr = `${quoteIdent(String(clause.column), dialect)} ${clause.not ? 'NOT IN' : 'IN'} (${placeholders})`;
            break;
          }
          break;
        case 'null':
          conditionStr = `${quoteIdent(String(clause.column), dialect)} IS ${clause.not ? 'NOT ' : ''}NULL`;
          break;
        case 'between': {
          const pair = clause.value;
          if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error('BETWEEN requires a [min, max] tuple');
          }
          params.push(...pair.map(normalizeBinding));
          conditionStr = `${quoteIdent(String(clause.column), dialect)} ${clause.not ? 'NOT BETWEEN' : 'BETWEEN'} ? AND ?`;
          break;
        }
        case 'exists': {
          const { sql, bindings } = clause.query!.toSql();
          params.push(...bindings);
          conditionStr = `${clause.not ? 'NOT ' : ''}EXISTS (${sql})`;
          break;
        }
        default:
          throw new Error('Unsupported where clause type');
      }
      const logical = index > 0 ? clause.logical || def : '';
      return `${logical} ${conditionStr}`;
    })
    .join(' ')
    .trim();
}

export function combineWhere(andPart: string, orPart: string): string {
  if (andPart && orPart) return `(${andPart}) OR (${orPart})`;
  return andPart || orPart;
}

export function compileSelect(state: CompileState, dialect: SqlDialect): { sql: string; bindings: unknown[] } {
  const selectItems =
    state.aggregates.length > 0
      ? state.aggregates.map((agg) => {
          const col = agg.column === '*' ? '*' : quoteIdent(agg.column, dialect);
          return `${agg.func}(${col}) AS ${quoteIdent(agg.alias || 'aggregate', dialect)}`;
        })
      : state.selectColumns.map((c) => qSelect(c, dialect));
  const distinct = state.isDistinct ? 'DISTINCT ' : '';
  const from =
    quoteTableRef(state.tableName, dialect) +
    (state.tableAlias ? ' ' + quoteIdent(state.tableAlias, dialect) : '');
  let sql = `SELECT ${distinct}${selectItems.join(', ')} FROM ${from}`;
  const params: unknown[] = [...(state.selectBindings || [])];
  if (state.joins.length > 0) {
    sql +=
      ' ' +
      state.joins.map((j) => `${j.type} JOIN ${quoteTableRef(j.table, dialect)} ON ${j.on}`).join(' ');
  }
  const whereClause = compileWhere(state.whereClauses, dialect, params, 'AND');
  const orWhereClause = compileWhere(state.orWhereClauses, dialect, params, 'OR');
  const combined = combineWhere(whereClause, orWhereClause);
  if (combined) sql += ` WHERE ${combined}`;
  if (state.groupByColumns.length > 0) {
    sql += ` GROUP BY ${state.groupByColumns.map((c) => quoteSelectItem(c, dialect)).join(', ')}`;
  }
  if (state.havingClauses.length > 0) {
    const havingClause = compileWhere(state.havingClauses, dialect, params, 'AND');
    if (havingClause) sql += ` HAVING ${havingClause}`;
  }
  if (state.unionParts.length === 0) {
    if (state.orderClauses.length > 0) {
      sql += ` ORDER BY ${state.orderClauses.map((o) => `${quoteSelectItem(o.column, dialect)} ${o.direction}`).join(', ')}`;
    }
    sql = applyPaging(sql, dialect, state.limitValue, state.offsetValue, params);
    return { sql, bindings: params };
  }
  for (const part of state.unionParts) {
    const { sql: subSql, bindings: subBindings } = part.query.toSql();
    sql += ` ${part.type} ${subSql}`;
    params.push(...subBindings);
  }
  if (state.orderClauses.length > 0) {
    sql += ` ORDER BY ${state.orderClauses.map((o) => `${quoteSelectItem(o.column, dialect)} ${o.direction}`).join(', ')}`;
  }
  sql = applyPaging(sql, dialect, state.limitValue, state.offsetValue, params);
  return { sql, bindings: params };
}
