import type { DatabaseExecutor, EventBus, SimulationController, MultiDbRegistry } from './types';

/**
 * Configuração global do QueryKit que permite definir executors padrão,
 * event bus, simuladores e configurações de múltiplos bancos de dados.
 * 
 * @example
 * ```typescript
 * // Configurar executor padrão
 * setDefaultExecutor(myDatabaseExecutor);
 * 
 * // Configurar event bus para logging
 * setEventBus(myEventBus);
 * 
 * // Configurar simulador para testes
 * setSimulationController(mySimulationController);
 * 
 * // Configurar múltiplos bancos
 * setMultiDbRegistry(myMultiDbRegistry);
 * ```
 */
export const QueryKitConfig: {
  defaultExecutor?: DatabaseExecutor;
  eventBus?: EventBus;
  simulation?: SimulationController;
  multiDb?: MultiDbRegistry;
  databaseName?: string;
  defaultDialect?: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';
  tableToDatabase?: Record<string, string>;
  executorResolver?: (tableName: string) => DatabaseExecutor | undefined;
} = {} as any;

/**
 * Define o executor padrão para todas as queries do QueryKit.
 * 
 * @param executor - Instância do DatabaseExecutor que será usado por padrão
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const myExecutor = new SQLiteExecutor('database.db');
 * 
 * // Como usar
 * setDefaultExecutor(myExecutor);
 * 
 * // Output: Executor padrão configurado para todas as queries
 * ```
 */
export function setDefaultExecutor(executor: DatabaseExecutor) { QueryKitConfig.defaultExecutor = executor; }

/**
 * Define o event bus para emissão de eventos do QueryKit.
 * 
 * @param bus - Instância do EventBus para gerenciar eventos
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const eventBus = new EventEmitter();
 * 
 * // Como usar
 * setEventBus(eventBus);
 * 
 * // Output: Event bus configurado para emitir eventos de queries
 * ```
 */
export function setEventBus(bus: EventBus) { QueryKitConfig.eventBus = bus; }

/**
 * Define o controlador de simulação para testes e desenvolvimento.
 * 
 * @param sim - Instância do SimulationController para simular dados
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const simController = new SimulationController();
 * 
 * // Como usar
 * setSimulationController(simController);
 * 
 * // Output: Simulador configurado para queries de teste
 * ```
 */
export function setSimulationController(sim: SimulationController) { QueryKitConfig.simulation = sim; }

/**
 * Define o registro de múltiplos bancos de dados.
 * 
 * @param reg - Instância do MultiDbRegistry para gerenciar múltiplos bancos
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const multiDb = new MultiDbRegistry();
 * multiDb.register('users', userDbExecutor);
 * multiDb.register('products', productDbExecutor);
 * 
 * // Como usar
 * setMultiDbRegistry(multiDb);
 * 
 * // Output: Múltiplos bancos configurados para queries distribuídas
 * ```
 */
export function setMultiDbRegistry(reg: MultiDbRegistry) { QueryKitConfig.multiDb = reg; }

/**
 * Define o nome do banco de dados padrão.
 * 
 * @param name - Nome do banco de dados padrão
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const databaseName = 'main_database';
 * 
 * // Como usar
 * setDatabaseName(databaseName);
 * 
 * // Output: Nome do banco padrão configurado
 * ```
 */
export function setDatabaseName(name: string) { (QueryKitConfig as any).databaseName = name; }

/**
 * Define o dialeto SQL padrão para o QueryKit.
 * 
 * @param dialect - Dialeto SQL padrão ('sqlite', 'mysql', 'postgres', 'mssql', 'oracle')
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const dialect = 'postgres';
 * 
 * // Como usar
 * setDefaultDialect(dialect);
 * 
 * // Output: Dialeto PostgreSQL configurado como padrão
 * ```
 */
export function setDefaultDialect(dialect: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle') { (QueryKitConfig as any).defaultDialect = dialect; }

/**
 * Define o mapeamento de tabelas para bancos de dados específicos.
 * 
 * @param map - Objeto mapeando nomes de tabelas para nomes de bancos
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const tableMap = {
 *   'users': 'user_database',
 *   'products': 'product_database',
 *   'orders': 'order_database'
 * };
 * 
 * // Como usar
 * setTableToDatabase(tableMap);
 * 
 * // Output: Mapeamento configurado para queries em bancos específicos
 * ```
 */
export function setTableToDatabase(map: Record<string, string>) { (QueryKitConfig as any).tableToDatabase = map; }

/**
 * Define uma função resolver personalizada para encontrar executors por tabela.
 * 
 * @param resolver - Função que recebe o nome da tabela e retorna o executor apropriado
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const customResolver = (tableName: string) => {
 *   if (tableName.startsWith('user_')) return userDbExecutor;
 *   if (tableName.startsWith('product_')) return productDbExecutor;
 *   return defaultExecutor;
 * };
 * 
 * // Como usar
 * setExecutorResolver(customResolver);
 * 
 * // Output: Resolver personalizado configurado para seleção inteligente de executors
 * ```
 */
export function setExecutorResolver(resolver: (tableName: string) => DatabaseExecutor | undefined) { (QueryKitConfig as any).executorResolver = resolver; }

/**
 * Obtém o executor apropriado para uma tabela específica, considerando
 * todas as configurações disponíveis (resolver personalizado, múltiplos bancos, etc.).
 * 
 * @param tableName - Nome da tabela para qual se deseja o executor
 * @param banksHint - Lista opcional de bancos para tentar primeiro
 * @returns DatabaseExecutor apropriado para a tabela
 * @throws Error se nenhum executor estiver configurado
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * setDefaultExecutor(defaultExecutor);
 * setMultiDbRegistry(multiDbRegistry);
 * setTableToDatabase({ 'users': 'user_db' });
 * 
 * // Como usar
 * const executor = getExecutorForTable('users', ['user_db', 'backup_db']);
 * 
 * // Output: Executor do banco 'user_db' para a tabela 'users'
 * ```
 */
export function getExecutorForTable(tableName: string, banksHint?: string[] | undefined): DatabaseExecutor {
  const cfg: any = QueryKitConfig as any;
  if (cfg.executorResolver) {
    const ex = cfg.executorResolver(tableName);
    if (ex) return ex;
  }
  if (banksHint && cfg.multiDb) {
    for (const db of banksHint) {
      try { const ex = cfg.multiDb.getAdapter(db); if (ex) return ex; } catch {}
    }
  }
  if (cfg.tableToDatabase && cfg.multiDb) {
    const db = cfg.tableToDatabase[tableName];
    if (db) return cfg.multiDb.getAdapter(db);
  }
  if (cfg.multiDb && cfg.databaseName) {
    return cfg.multiDb.getAdapter(cfg.databaseName);
  }
  if (!cfg.defaultExecutor) throw new Error('No executor configured for QueryKit');
  return cfg.defaultExecutor;
} 