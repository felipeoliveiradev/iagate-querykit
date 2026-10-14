/**
 * Normalize a bound value so drivers receive something they can store.
 * - Date → ISO-8601 UTC string
 * - plain object / array → JSON text
 * - undefined is rejected (it is never a SQL NULL)
 * - null, number, string, boolean, bigint, Buffer stay as-is
 */
export function normalizeBinding(value: unknown): unknown {
  if (value === undefined) {
    throw new Error('Cannot bind undefined. Use null for SQL NULL.');
  }
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Cannot bind an invalid Date');
    return value.toISOString();
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value;
  if (typeof value === 'bigint') return value;
  const t = typeof value;
  if (t === 'function' || t === 'symbol') {
    throw new Error(`Cannot bind a ${t}. Use null, a primitive, Date, Buffer, or a plain object.`);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return JSON.stringify(value);
    }
    const name = (value as { constructor?: { name?: string } }).constructor?.name || 'object';
    throw new Error(`Cannot bind a ${name} instance. Use null, a primitive, Date, Buffer, or a plain object.`);
  }
  return value;
}

export function normalizeBindings(values: unknown[]): unknown[] {
  return values.map(normalizeBinding);
}
