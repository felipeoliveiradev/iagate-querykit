/** Convert a BigInt that fits in MAX_SAFE_INTEGER to number; keep the rest. */
export function hydrateInteger(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  return value;
}

export function hydrateRow<T = any>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = Array.isArray(row) ? (row.slice() as any) : { ...src };
  for (const key of Object.keys(out)) {
    out[key] = hydrateInteger(out[key]);
  }
  return out as T;
}

export function hydrateRows<T = any>(rows: T[]): T[] {
  return rows.map((r) => hydrateRow(r));
}
