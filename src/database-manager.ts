import { BaseDatabaseAdapter, type DatabaseConfig, type QueryResult } from './database-adapters/base-adapter';

/**
 * Configuração para múltiplos bancos de dados.
 * Define qual banco é o padrão e as configurações de cada banco individual.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const multiDbConfig: MultiDatabaseConfig = {
 *   defaultDatabase: 'main',
 *   databases: {
 *     main: { host: 'localhost', port: 5432, database: 'main_db' },
 *     analytics: { host: 'analytics-server', port: 5432, database: 'analytics_db' }
 *   }
 * };
 * 
 * // Como usar
 * const manager = MultiDatabaseManager.getInstance(multiDbConfig);
 * 
 * // Output: Gerenciador de múltiplos bancos configurado
 * ```
 */
export interface MultiDatabaseConfig {
  /** Nome do banco de dados padrão */
  defaultDatabase: string;
  /** Configurações de cada banco de dados */
  databases: Record<string, DatabaseConfig>;
}

/**
 * Gerenciador de múltiplos bancos de dados usando o padrão Singleton.
 * Permite executar queries em diferentes bancos simultaneamente e
 * gerenciar conexões de forma centralizada.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const config: MultiDatabaseConfig = {
 *   defaultDatabase: 'users',
 *   databases: {
 *     users: { host: 'localhost', database: 'users_db' },
 *     products: { host: 'localhost', database: 'products_db' }
 *   }
 * };
 * 
 * // Como usar
 * const manager = MultiDatabaseManager.getInstance(config);
 * await manager.initialize(createPostgresAdapter);
 * 
 * // Output: Gerenciador inicializado com adapters conectados
 * ```
 */
export class MultiDatabaseManager {
  private static instance: MultiDatabaseManager;
  private adapters: Map<string, BaseDatabaseAdapter> = new Map();
  private config: MultiDatabaseConfig;

  private constructor(config: MultiDatabaseConfig) {
    this.config = config;
  }

  /**
   * Obtém a instância única do MultiDatabaseManager (Singleton).
   * Se config for fornecido e não houver instância, cria uma nova.
   * 
   * @param config - Configuração opcional para múltiplos bancos
   * @returns Instância única do MultiDatabaseManager
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const config: MultiDatabaseConfig = { ...  };
   * 
   * // Como usar
   * const manager = MultiDatabaseManager.getInstance(config);
   * 
   * // Output: Instância única do gerenciador obtida
   * ```
   */
  static getInstance(config?: MultiDatabaseConfig) {
    if (!MultiDatabaseManager.instance && config) {
      MultiDatabaseManager.instance = new MultiDatabaseManager(config);
    }
    return MultiDatabaseManager.instance;
  }

  /**
   * Inicializa todos os adapters de banco de dados configurados.
   * Cria e conecta cada adapter usando a função factory fornecida.
   * 
   * @param createAdapter - Função factory para criar adapters
   * @returns Promise que resolve quando todos os adapters estiverem conectados
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const createPostgresAdapter = (config: DatabaseConfig) => new PostgresAdapter(config);
   * 
   * // Como usar
   * await manager.initialize(createPostgresAdapter);
   * 
   * // Output: Todos os adapters inicializados e conectados
   * ```
   */
  async initialize(createAdapter: (config: DatabaseConfig) => BaseDatabaseAdapter) {
    for (const [name, dbConfig] of Object.entries(this.config.databases)) {
      const adapter = createAdapter(dbConfig);
      await adapter.connect();
      this.adapters.set(name, adapter);
    }
  }

  /**
   * Obtém um adapter específico pelo nome.
   * 
   * @param name - Nome do banco de dados
   * @returns Adapter do banco especificado
   * @throws Error se o adapter não for encontrado
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const manager = MultiDatabaseManager.getInstance(config);
   * 
   * // Como usar
   * const userAdapter = manager.getAdapter('users');
   * 
   * // Output: Adapter do banco 'users' obtido com sucesso
   * ```
   */
  getAdapter(name: string): BaseDatabaseAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`Database adapter '${name}' not found`);
    return adapter;
  }

  /**
   * Obtém o adapter padrão configurado.
   * 
   * @returns Adapter do banco padrão
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const manager = MultiDatabaseManager.getInstance(config);
   * 
   * // Como usar
   * const defaultAdapter = manager.getDefaultAdapter();
   * 
   * // Output: Adapter padrão obtido (ex: 'users')
   * ```
   */
  getDefaultAdapter(): BaseDatabaseAdapter { return this.getAdapter(this.config.defaultDatabase); }

  /**
   * Executa uma query em múltiplos bancos de dados simultaneamente.
   * Útil para operações que precisam ser replicadas em vários bancos.
   * 
   * @param databaseNames - Lista de nomes dos bancos onde executar a query
   * @param query - Query SQL a ser executada
   * @param params - Parâmetros opcionais para a query
   * @returns Objeto com resultados de cada banco, indexado pelo nome
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const manager = MultiDatabaseManager.getInstance(config);
   * const query = 'SELECT COUNT(*) as total FROM users';
   * 
   * // Como usar
   * const results = await manager.executeOnMultiple(['users', 'analytics'], query);
   * 
   * // Output: { users: { data: [{ total: 150 }] }, analytics: { data: [{ total: 150 }] } }
   * ```
   */
  async executeOnMultiple(databaseNames: string[], query: string, params?: any[]): Promise<Record<string, QueryResult>> {
    const results: Record<string, QueryResult> = {};
    await Promise.all(databaseNames.map(async (name) => {
      try {
        const adapter = this.getAdapter(name);
        results[name] = await adapter.executeQuery(query, params);
      } catch (error) {
        results[name] = { data: [], metadata: { error: (error as Error).message } } as any;
      }
    }));
    return results;
  }
} 