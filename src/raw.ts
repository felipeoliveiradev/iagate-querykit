/**
 * Classe para representar SQL raw (bruto) no QueryKit.
 * Permite inserir SQL customizado diretamente nas queries.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const rawSql = new Raw('COUNT(*) as total');
 * 
 * // Como usar
 * const query = table('users').select(rawSql);
 * 
 * // Output: QueryBuilder com SQL raw incluído
 * ```
 */
export class Raw {
  /**
   * Cria uma instância de Raw com SQL customizado.
   * 
   * @param sql - String SQL para usar como raw
   */
  constructor(private sql: string) {}
  
  /**
   * Retorna o SQL raw como string.
   * 
   * @returns String SQL armazenada
   */
  toSQL() { return this.sql; }
}

/**
 * Factory function para criar instâncias de Raw.
 * Forma mais concisa de criar SQL raw.
 * 
 * @param sql - String SQL para usar como raw
 * @returns Nova instância de Raw
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const sql = 'UPPER(name) as name_upper';
 * 
 * // Como usar
 * const rawField = raw(sql);
 * const query = table('users').select(rawField);
 * 
 * // Output: QueryBuilder com campo SQL raw UPPER(name)
 * ```
 */
export function raw(sql: string) { return new Raw(sql); } 