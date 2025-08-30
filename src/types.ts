/**
 * Resultado de uma query executada no banco de dados.
 * Contém os dados retornados e informações sobre o impacto da operação.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const queryResult = await db.executeQuery('SELECT * FROM users WHERE age > 18');
 * 
 * // Como usar
 * console.log(queryResult.data); // Array com os usuários
 * console.log(queryResult.affectedRows); // Número de linhas afetadas (para INSERT/UPDATE/DELETE)
 * console.log(queryResult.lastInsertId); // ID da última inserção (para INSERT)
 * 
 * // Output: { data: [{ id: 1, name: 'John', age: 25 }], affectedRows: undefined, lastInsertId: undefined }
 * ```
 */
export type QueryResult = { data: any[]; affectedRows?: number; lastInsertId?: number | string };

/**
 * Interface para execução de queries SQL no banco de dados.
 * Define métodos para executar queries de forma síncrona e assíncrona.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class SQLiteExecutor implements DatabaseExecutor {
 *   async executeQuery(sql: string, bindings: any[]): Promise<QueryResult> {
 *     // Implementação da query
 *     return { data: [], affectedRows: 0 };
 *   }
 * }
 * 
 * // Como usar
 * const executor = new SQLiteExecutor();
 * const result = await executor.executeQuery('SELECT * FROM users', []);
 * 
 * // Output: Query executada com sucesso retornando dados
 * ```
 */
export interface DatabaseExecutor {
  /**
   * Executa uma query SQL de forma assíncrona.
   * 
   * @param sql - Query SQL a ser executada
   * @param bindings - Parâmetros para a query (prevenção de SQL injection)
   * @returns Promise com o resultado da query
   */
  executeQuery(sql: string, bindings: any[]): Promise<QueryResult>;
  
  /**
   * Executa uma query SQL de forma síncrona (opcional).
   * 
   * @param sql - Query SQL a ser executada
   * @param bindings - Parâmetros para a query
   * @returns Resultado da query executada de forma síncrona
   */
  executeQuerySync?(sql: string, bindings: any[]): QueryResult;
  
  /**
   * Executa uma query que não retorna dados (INSERT, UPDATE, DELETE).
   * 
   * @param sql - Query SQL a ser executada
   * @param bindings - Parâmetros para a query
   * @returns Promise com informações sobre as mudanças realizadas
   */
  run?(sql: string, bindings: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  
  /**
   * Executa uma query que não retorna dados de forma síncrona.
   * 
   * @param sql - Query SQL a ser executada
   * @param bindings - Parâmetros para a query
   * @returns Informações sobre as mudanças realizadas
   */
  runSync?(sql: string, bindings: any[]): { changes: number; lastInsertRowid: number | bigint };
  
  /**
   * Dialeto SQL suportado pelo executor.
   */
  dialect?: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';
}

/**
 * Interface para emissão de eventos no sistema.
 * Permite que diferentes partes do sistema se comuniquem através de eventos.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class EventEmitter implements EventBus {
 *   emit(event: string, payload?: any): void {
 *     // Emite o evento
 *     console.log(`Event: ${event}`, payload);
 *   }
 * }
 * 
 * // Como usar
 * const eventBus = new EventEmitter();
 * eventBus.emit('query.executed', { sql: 'SELECT * FROM users', duration: 150 });
 * 
 * // Output: Evento 'query.executed' emitido com payload
 * ```
 */
export interface EventBus {
  /**
   * Emite um evento com payload opcional.
   * 
   * @param event - Nome do evento a ser emitido
   * @param payload - Dados opcionais do evento
   */
  emit(event: string, payload?: any): void;
}

/**
 * Interface para controlar simulações de banco de dados.
 * Útil para testes e desenvolvimento sem afetar dados reais.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class SimulationController implements SimulationController {
 *   private simulationState: Record<string, any[]> = {};
 *   private isSimulationActive = false;
 * 
 *   isActive(): boolean {
 *     return this.isSimulationActive;
 *   }
 * 
 *   getStateFor(tableName: string): any[] | undefined {
 *     return this.simulationState[tableName];
 *   }
 * 
 *   updateStateFor(tableName: string, data: any[]): void {
 *     this.simulationState[tableName] = data;
 *   }
 * 
 *   start(initialState: Record<string, any[]>): void {
 *     this.simulationState = initialState;
 *     this.isSimulationActive = true;
 *   }
 * 
 *   stop(): void {
 *     this.isSimulationActive = false;
 *     this.simulationState = {};
 *   }
 * }
 * 
 * // Como usar
 * const simController = new SimulationController();
 * simController.start({ users: [{ id: 1, name: 'Test User' }] });
 * 
 * // Output: Simulação iniciada com dados iniciais
 * ```
 */
export interface SimulationController {
  /**
   * Verifica se a simulação está ativa.
   * 
   * @returns true se a simulação estiver ativa, false caso contrário
   */
  isActive(): boolean;
  
  /**
   * Obtém o estado atual de uma tabela na simulação.
   * 
   * @param tableName - Nome da tabela
   * @returns Dados da tabela na simulação ou undefined se não existir
   */
  getStateFor(tableName: string): any[] | undefined;
  
  /**
   * Atualiza o estado de uma tabela na simulação.
   * 
   * @param tableName - Nome da tabela
   * @param data - Novos dados para a tabela
   */
  updateStateFor(tableName: string, data: any[]): void;
  
  /**
   * Inicia a simulação com estado inicial.
   * 
   * @param initialState - Estado inicial das tabelas
   */
  start(initialState: Record<string, any[] | any>): Promise<void> | void;
  
  /**
   * Para a simulação e limpa o estado.
   */
  stop(): Promise<void> | void;
}

/**
 * Interface para gerenciar múltiplos bancos de dados.
 * Permite executar queries em diferentes bancos baseado no nome da tabela.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class MultiDbRegistry implements MultiDbRegistry {
 *   private adapters: Map<string, DatabaseExecutor> = new Map();
 * 
 *   register(name: string, executor: DatabaseExecutor): void {
 *     this.adapters.set(name, executor);
 *   }
 * 
 *   getAdapter(databaseName: string): DatabaseExecutor {
 *     const executor = this.adapters.get(databaseName);
 *     if (!executor) throw new Error(`Database ${databaseName} not found`);
 *     return executor;
 *   }
 * }
 * 
 * // Como usar
 * const registry = new MultiDbRegistry();
 * registry.register('users_db', userDbExecutor);
 * registry.register('products_db', productDbExecutor);
 * 
 * const userExecutor = registry.getAdapter('users_db');
 * 
 * // Output: Executor do banco 'users_db' obtido com sucesso
 * ```
 */
export interface MultiDbRegistry {
  /**
   * Obtém o executor para um banco de dados específico.
   * 
   * @param databaseName - Nome do banco de dados
   * @returns Executor do banco especificado
   * @throws Error se o banco não for encontrado
   */
  getAdapter(databaseName: string): DatabaseExecutor;
} 