import { QueryBuilder } from './query-builder.js';
import type { DatabaseExecutor } from './types.js';

/**
 * Factory function para criar QueryBuilders para uma tabela específica.
 * Ponto de entrada principal para construir queries no QueryKit.
 * 
 * @param tableName - Nome da tabela para criar o QueryBuilder
 * @returns Nova instância de QueryBuilder configurada para a tabela
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const tableName = 'users';
 * 
 * // Como usar
 * const query = table(tableName).select('*').where('active', true);
 * const users = await query.all();
 * 
 * // Output: QueryBuilder configurado para tabela 'users' com query executada
 * // users = [{ id: 1, name: 'John', active: true }, { id: 2, name: 'Jane', active: true }]
 * ```
 */
export const table = <T extends Record<string, any>>(
  tableName: string,
  executor?: DatabaseExecutor,
) => new QueryBuilder<T>(tableName, executor ? { executor } : undefined); 