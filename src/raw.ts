export class Raw {
  constructor(private sql: string) {}
  toSQL() { return this.sql; }
}
export function raw(sql: string) { return new Raw(sql); } 