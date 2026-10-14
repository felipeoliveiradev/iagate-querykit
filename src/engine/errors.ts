import { DriverError, QueryKitError } from '../sql/errors.js';

export class UnsupportedFeatureError extends QueryKitError {
  readonly feature: string;

  constructor(feature: string, dialect?: string) {
    super(
      dialect
        ? `Dialect '${dialect}' does not support ${feature}`
        : `Unsupported feature: ${feature}`,
      'UNSUPPORTED',
    );
    this.feature = feature;
  }
}

export type DriverErrorContext = {
  sql?: string;
  bindings?: unknown[];
  dialect?: string;
};

export function redactParams(bindings: unknown[] | undefined): unknown[] {
  if (!bindings) return [];
  return bindings.map((value, index) => redactOne(value, index));
}

function redactOne(value: unknown, index: number): Record<string, unknown> {
  if (value === null || value === undefined) return { i: index, type: 'null', value: null };
  if (typeof value === 'string') {
    const looksSecret = /pass|secret|token|key|pwd/i.test(value) || value.length > 48;
    return {
      i: index,
      type: 'string',
      value: looksSecret ? `<string:${value.length}>` : value,
    };
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { i: index, type: typeof value, value: String(value) };
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { i: index, type: 'buffer', value: `<buffer:${value.length}>` };
  }
  return { i: index, type: typeof value, value: `<${typeof value}>` };
}

export function normalizeDriverCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'DRIVER';
  const e = err as { code?: unknown; errorNum?: unknown; number?: unknown; errno?: unknown };
  if (typeof e.code === 'string' && e.code.trim()) return e.code;
  if (typeof e.errorNum === 'number') return `ORA-${e.errorNum}`;
  if (typeof e.number === 'number') return `MSSQL-${e.number}`;
  if (typeof e.errno === 'number') return `ERRNO-${e.errno}`;
  return 'DRIVER';
}

export function toDriverError(err: unknown, ctx: DriverErrorContext = {}): DriverError {
  if (err instanceof DriverError) return err;
  if (err instanceof QueryKitError) {
    return new DriverError({
      message: err.message,
      cause: err,
      sql: ctx.sql,
      params: redactParams(ctx.bindings),
      driverCode: err.code,
      code: err.code === 'QUERYKIT' ? 'DRIVER' : err.code,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new DriverError({
    message,
    cause: err,
    sql: ctx.sql,
    params: redactParams(ctx.bindings),
    driverCode: normalizeDriverCode(err),
    dialect: ctx.dialect,
  });
}

export async function wrapDriverCall<T>(
  fn: () => Promise<T> | T,
  ctx: DriverErrorContext = {},
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QueryKitError && !(err instanceof DriverError) && err.code !== 'DRIVER') {
      throw err;
    }
    throw toDriverError(err, ctx);
  }
}

export function wrapDriverSync<T>(fn: () => T, ctx: DriverErrorContext = {}): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof QueryKitError && !(err instanceof DriverError) && err.code !== 'DRIVER') {
      throw err;
    }
    throw toDriverError(err, ctx);
  }
}
