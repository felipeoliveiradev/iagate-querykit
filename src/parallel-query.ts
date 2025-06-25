import { QueryBuilder } from './query-builder';

export async function parallel(...queries: QueryBuilder<any>[]): Promise<any[]> {
  const promises = queries.map(async (query) => {
    const { sql } = query.toSql();
    if (/^\s*select\s/i.test(sql)) return query.all();
    return query.run();
  });
  return Promise.all(promises);
} 