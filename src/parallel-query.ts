import { QueryBuilder } from './query-builder';

export async function parallel(...queries: QueryBuilder<any>[]): Promise<any[]> {
  const promises = queries.map(async (query) => {
    if ((query as any).hasPendingWrite && (query as any).hasPendingWrite()) return query.make();
    return query.all();
  });
  return Promise.all(promises);
} 