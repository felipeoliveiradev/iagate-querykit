import { QueryBuilder } from './query-builder';

/**
 * Executa múltiplas queries em paralelo para melhor performance.
 * Detecta automaticamente se a query tem operações de escrita pendentes.
 * 
 * @param queries - Array de QueryBuilders para executar em paralelo
 * @returns Promise que resolve com array de resultados de todas as queries
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const userQuery = table('users').select('*').where('active', true);
 * const productQuery = table('products').select('*').where('category', 'electronics');
 * const orderQuery = table('orders').select('*').where('status', 'pending');
 * 
 * // Como usar
 * const [users, products, orders] = await parallel(userQuery, productQuery, orderQuery);
 * 
 * // Output: Array com resultados de todas as queries executadas em paralelo
 * // users = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }]
 * // products = [{ id: 1, name: 'Laptop' }, { id: 2, name: 'Phone' }]
 * // orders = [{ id: 1, user_id: 1, total: 100 }]
 * ```
 */
export async function parallel(...queries: QueryBuilder<any>[]): Promise<any[]> {
  const promises = queries.map(async (query) => {
    if ((query as any).hasPendingWrite && (query as any).hasPendingWrite()) return query.make();
    return query.all();
  });
  return Promise.all(promises);
} 