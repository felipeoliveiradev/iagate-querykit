import { QueryBuilder } from './query-builder';

export const table = <T extends Record<string, any>>(tableName: string) => new QueryBuilder<T>(tableName); 