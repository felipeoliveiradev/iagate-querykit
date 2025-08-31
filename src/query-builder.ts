import { QueryKitConfig, getExecutorForTable } from './config';
import { raw } from './raw';
import { simulationManager } from './simulation-manager';
import { eventManager } from './event-manager';

/**
 * Operadores SQL suportados para comparações em cláusulas WHERE.
 * Inclui operadores de igualdade, comparação, padrão e verificação de valores nulos.
 */
export type Operator = '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'BETWEEN' | 'NOT BETWEEN' | 'IS NULL' | 'IS NOT NULL';

/**
 * Estrutura de uma cláusula WHERE individual.
 * Define o tipo de condição, coluna, operador, valor e conectivo lógico.
 * 
 * @template T - Tipo genérico da entidade da tabela
 */
type WhereClause<T = any> = {
  type: 'basic' | 'raw' | 'column' | 'in' | 'null' | 'between' | 'exists';
  column?: keyof T | string;
  operator?: Operator;
  value?: any;
  sql?: string;
  query?: QueryBuilder<any>;
  logical: 'AND' | 'OR';
  not?: boolean;
};

/**
 * Configuração de função de agregação SQL.
 * Define a função (COUNT, SUM, AVG, MIN, MAX), coluna alvo e alias opcional.
 */
type Aggregate = { func: 'count' | 'sum' | 'avg' | 'min' | 'max'; column: string; alias?: string };

/**
 * Opções para controle de limite de memória durante execução de queries.
 * Permite definir estratégias de chunking, streaming ou paginação.
 */
type MemoryLimitOptions = { bytes: number; strategy?: 'chunk' | 'stream' | 'paginate'; onLimitReached?: (currentUsage: number, limit: number) => void };

/**
 * Seletor de relacionamentos para carregamento eager de dados relacionados.
 * Permite especificar quais relacionamentos carregar e quais colunas selecionar.
 * 
 * @template T - Tipo genérico da entidade principal
 */
export type RelationshipSelector<T> = (rel: (name: string, select?: string[]) => void) => void

/**
 * QueryBuilder - Construtor de consultas SQL fluente e type-safe.
 * 
 * Esta classe fornece uma interface fluente para construir consultas SQL complexas
 * com suporte completo a operações CRUD, relacionamentos, agregações e simulação.
 * 
 * Características principais:
 * - API fluente com method chaining
 * - Suporte completo a operadores SQL
 * - Sistema de eventos para hooks antes/depois das operações
 * - Simulação de queries para desenvolvimento e testes
 * - Suporte a múltiplos bancos de dados
 * - Carregamento automático de relacionamentos
 * - Geração de SQL parametrizado com bindings
 * 
 * @template T - Tipo da entidade da tabela, deve estender Record<string, any> e opcionalmente ter um campo 'id'
 * 
 * @example
 * // Exemplo básico de uso
 * const users = await new QueryBuilder<User>('users')
 *   .select(['id', 'name', 'email'])
 *   .where('active', '=', true)
 *   .where('age', '>', 18)
 *   .orderBy('name', 'ASC')
 *   .limit(10)
 *   .all();
 * 
 * @example
 * // Exemplo com relacionamentos
 * const posts = await new QueryBuilder<Post>('posts')
 *   .where('published', '=', true)
 *   .relationship(rel => {
 *     rel('author', ['id', 'name']);
 *     rel('comments', ['id', 'content']);
 *   })
 *   .all();
 * 
 * @example
 * // Exemplo de operação de escrita
 * const result = await new QueryBuilder<User>('users')
 *   .where('id', '=', 1)
 *   .update({ lastLogin: new Date() })
 *   .make();
 */
export class QueryBuilder<T extends { id?: any } & Record<string, any>> {
  private tableName: string;
  private whereClauses: WhereClause<T>[] = [];
  private orWhereClauses: WhereClause<T>[] = [];
  private joins: { type: 'INNER' | 'LEFT' | 'RIGHT'; table: string; on: string }[] = [];
  private selectColumns: (keyof T | string | any)[] = ['*'];
  private orderClauses: { column: string; direction: 'ASC' | 'DESC' }[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private groupByColumns: string[] = [];
  private havingClauses: WhereClause<T>[] = [];
  private isDistinct = false;
  private pendingAction?: { type: string; data?: any; attributes?: any };
  private aggregates: Aggregate[] = [];
  private tableAlias?: string;
  private unionParts: { type: 'UNION' | 'UNION ALL'; query: QueryBuilder<any> }[] = [];
  private targetBanks?: string[];

  private isTracking: boolean = false;
  private isSeeding: boolean = false;
  private trackingLogs: { step: string; details: any; timestamp: Date }[] = [];
  private virtualTable: T[] = [];
  private includeAllRelations: boolean | RelationshipSelector<T> = false

  /**
   * Construtor da classe QueryBuilder.
   * Inicializa uma nova instância para construir consultas na tabela especificada.
   * 
   * @param tableName - Nome da tabela alvo para as consultas
   * 
   * @example
   * // Exemplo básico - Inicialização simples
   * const query = new QueryBuilder<User>('users');
   * 
   * @example
   * // Exemplo com tabela customizada
   * const query = new QueryBuilder<Order>('customer_orders');
   * 
   * @example
   * // Exemplo para tabela de sistema
   * const query = new QueryBuilder<Log>('system_logs');
   */
  constructor(tableName: string) { this.tableName = tableName; }

  /**
   * Define o banco de dados de destino para a query.
   * Permite especificar qual banco de dados usar quando há múltiplos bancos configurados.
   * 
   * @param bankOrBanks - Nome do banco ou array de nomes de bancos
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Banco único
   * const query = new QueryBuilder<User>('users')
   *   .bank('postgres')
   *   .where('active', '=', true);
   * 
   * @example
   * // Exemplo intermediário - Múltiplos bancos
   * const query = new QueryBuilder<User>('users')
   *   .bank(['postgres', 'mysql'])
   *   .where('created_at', '>', new Date('2024-01-01'));
   * 
   * @example
   * // Exemplo avançado - Sistema multi-banco com fallback
   * class MultiDatabaseService {
   *   static async getUserFromMultipleSources(userId: number): Promise<User[]> {
   *     const primaryQuery = new QueryBuilder<User>('users')
   *       .bank('postgres')
   *       .where('id', '=', userId);
   *     
   *     const backupQuery = new QueryBuilder<User>('users')
   *       .bank('mysql')
   *       .where('id', '=', userId);
   *     
   *     try {
   *       const primaryResult = await primaryQuery.all();
   *       if (primaryResult.length > 0) return primaryResult;
   *     } catch (error) {
   *       console.log('Falha no banco primário, tentando backup...');
   *     }
   *     
   *     return await backupQuery.all();
   *   }
   * }
   */
  bank(bankOrBanks: string | string[]): this {
    this.targetBanks = Array.isArray(bankOrBanks) ? bankOrBanks : [bankOrBanks];
    return this;
  }

  /**
   * Verifica se existe uma operação de escrita pendente na instância atual.
   * Útil para validação antes de executar operações ou para debugging.
   * 
   * @returns true se há uma operação de escrita pendente, false caso contrário
   * 
   * @example
   * // Exemplo básico - Verificação simples
   * const query = new QueryBuilder<User>('users').insert({ name: 'John' });
   * if (query.hasPendingWrite()) {
   *   console.log('Query tem operação pendente');
   * }
   * 
   * @example
   * // Exemplo intermediário - Validação antes de executar
   * const query = new QueryBuilder<User>('users')
   *   .where('id', '=', 1)
   *   .update({ lastLogin: new Date() });
   *   
   * if (!query.hasPendingWrite()) {
   *   throw new Error('Nenhuma operação de escrita configurada');
   * }
   * 
   * @example
   * // Exemplo avançado - Sistema de validação complexo
   * class QueryValidator {
   *   static validateBeforeExecution(query: QueryBuilder<any>): void {
   *     if (query.hasPendingWrite()) {
   *       const action = query['pendingAction'];
   *       if (action?.type === 'delete' && !query['whereClauses'].length) {
   *         throw new Error('DELETE sem WHERE clause é perigoso!');
   *       }
   *     }
   *   }
   * }
   */
  public hasPendingWrite(): boolean {
    return !!this.pendingAction && ['insert', 'update', 'delete', 'updateOrInsert', 'increment', 'decrement'].includes(this.pendingAction.type);
  }

  /**
   * Método privado para registrar logs de tracking durante a execução da query.
   * Utilizado internamente para monitorar o comportamento das operações.
   * 
   * @param step - Nome da etapa sendo executada
   * @param details - Detalhes adicionais da operação
   */
  private track(step: string, details: any = {}) {
    if (this.isTracking || simulationManager.isActive()) this.trackingLogs.push({ step, details, timestamp: new Date() });
  }

  /**
   * Inicializa o sistema de tracking para monitorar a execução da query.
   * Permite simular operações em memória ou rastrear execuções reais no banco.
   * 
   * @param data - Dados opcionais para inicializar a tabela virtual (para simulação)
   * @returns Promise que resolve para a instância atual do QueryBuilder
   * 
   * @example
   * // Exemplo básico - Inicialização com dados existentes
   * const query = new QueryBuilder<User>('users')
   *   .initial([
   *     { id: 1, name: 'John', email: 'john@example.com' },
   *     { id: 2, name: 'Jane', email: 'jane@example.com' }
   *   ]);
   * 
   * @example
   * // Exemplo intermediário - Tracking de query real
   * const query = new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .await initial(); // Carrega dados reais do banco
   * 
   * @example
   * // Exemplo avançado - Sistema de simulação complexo
   * class QuerySimulator {
   *   async simulateUserOperations(): Promise<void> {
   *     const query = new QueryBuilder<User>('users')
   *       .where('role', '=', 'admin')
   *       .await initial(); // Carrega dados reais
   *     
   *     // Simula operações complexas
   *     query.insert({ name: 'New Admin', role: 'admin' });
   *     query.where('id', '=', 1).update({ lastLogin: new Date() });
   *     
   *     const logs = query.tracking();
   *     console.log('Operações simuladas:', logs);
   *   }
   * }
   */
  async initial(data?: T[]): Promise<this> {
    this.isTracking = true;
    this.trackingLogs = [];
    if (data) {
      this.virtualTable = JSON.parse(JSON.stringify(data));
      this.track('tracking.initialized', { source: 'manual', count: data.length });
    } else {
      this.track('tracking.seeding_from_db', { query: this.toSql() });
      this.isSeeding = true;
      try {
        const results = await this.all<T>();
        this.virtualTable = results;
        this.track('tracking.initialized', { source: 'database', table: this.tableName, count: results.length });
      } finally {
        this.isSeeding = false;
      }
    }
    return this;
  }

  /**
   * Retorna os logs de tracking das operações executadas na instância.
   * Deve ser chamado após .initial() para funcionar corretamente.
   * 
   * @returns Array de logs com detalhes de cada operação executada
   * 
   * @example
   * // Exemplo básico - Obter logs de tracking
   * const query = new QueryBuilder<User>('users')
   *   .await initial()
   *   .insert({ name: 'John' });
   *   
   * const logs = query.tracking();
   * console.log('Logs:', logs);
   * 
   * @example
   * // Exemplo intermediário - Análise detalhada dos logs
   * const query = new QueryBuilder<User>('users')
   *   .await initial()
   *   .where('id', '=', 1)
   *   .update({ lastLogin: new Date() });
   *   
   * const logs = query.tracking();
   * const updateLogs = logs.filter(log => log.step.includes('update'));
   * console.log('Logs de atualização:', updateLogs);
   * 
   * @example
   * // Exemplo avançado - Sistema de auditoria completo
   * class QueryAuditor {
   *   async auditQuery(query: QueryBuilder<any>): Promise<AuditReport> {
   *     const logs = query.tracking();
   *     
   *     const report: AuditReport = {
   *       totalOperations: logs.length,
   *       operations: logs.map(log => ({
   *         step: log.step,
   *         timestamp: log.timestamp,
   *         details: log.details
   *       })),
   *       hasWrites: logs.some(log => 
   *         ['insert', 'update', 'delete'].includes(log.step)
   *       ),
   *       executionTime: logs.length > 0 ? 
   *         logs[logs.length - 1].timestamp.getTime() - logs[0].timestamp.getTime() : 0
   *     };
   *     
   *     return report;
   *   }
   * }
   */
  tracking(): { step: string; details: any; timestamp: Date }[] {
    if (!this.isTracking) return [{ step: 'error', details: 'Tracking was not enabled. Call .initial() before .tracking().', timestamp: new Date() }];
    if (this.pendingAction) {
      this.track('virtual_execution.start', this.pendingAction);
      this.executeVirtualAction();
      this.track('virtual_execution.end', { finalVirtualTableState: this.virtualTable });
      this.pendingAction = undefined;
    } else {
      this.track('dry_run_select.summary', this.toSql());
    }
    return this.trackingLogs;
  }

  private applyWhereClausesToVirtual(data: T[]): T[] {
    if (this.whereClauses.length === 0) return data;
    return data.filter(row => this.whereClauses.every(clause => {
      if (clause.type === 'basic' && clause.operator === '=') return row[clause.column as keyof T] === clause.value;
      return true;
    }));
  }

  private executeVirtualAction(): void {
    if (!this.pendingAction) return;
    const { type, data } = this.pendingAction;
    switch (type) {
      case 'insert': this.virtualTable.push(...data); break;
      case 'update': {
        const rowsToUpdate = this.applyWhereClausesToVirtual(this.virtualTable);
        rowsToUpdate.forEach(row => Object.assign(row, data));
        break;
      }
      case 'delete': {
        const rowsToDelete = this.applyWhereClausesToVirtual(this.virtualTable);
        const idsToDelete = new Set(rowsToDelete.map(r => r.id));
        this.virtualTable = this.virtualTable.filter(row => !idsToDelete.has(row.id));
        break;
      }
    }
    if (simulationManager.isActive()) simulationManager.updateStateFor(this.tableName, this.virtualTable);
  }

  /**
   * Define as colunas a serem selecionadas na consulta.
   * Por padrão seleciona todas as colunas (*) se nenhuma for especificada.
   * 
   * @param columns - Array de nomes de colunas ou chaves do tipo T
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Seleção de colunas específicas
   * const users = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Seleção com tipos genéricos
   * const userStats = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'created_at', 'last_login'])
   *   .where('active', '=', true)
   *   .orderBy('created_at', 'DESC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Seleção dinâmica baseada em condições
   * class DynamicSelector {
   *   static getColumnsForRole(role: string): (keyof User)[] {
   *     const baseColumns: (keyof User)[] = ['id', 'name'];
   *     
   *     switch (role) {
   *       case 'admin':
   *         return [...baseColumns, 'email', 'role', 'permissions', 'last_login'];
   *       case 'moderator':
   *         return [...baseColumns, 'email', 'role', 'last_login'];
   *       default:
   *         return [...baseColumns, 'email'];
   *     }
   *   }
   *   
   *   static async getUsersByRole(role: string): Promise<User[]> {
   *     const columns = this.getColumnsForRole(role);
   *     return await new QueryBuilder<User>('users')
   *       .select(columns)
   *       .where('role', '=', role)
   *       .all();
   *   }
   * }
   */
  select(columns: (keyof T | string)[] = ['*']): this { this.track('select', { columns }); this.selectColumns = columns.map(c => String(c)); return this; }
  
  /**
   * Adiciona uma expressão SQL raw à seleção.
   * Permite incluir funções SQL, cálculos ou expressões complexas na consulta.
   * 
   * @param sql - Expressão SQL raw a ser incluída na seleção
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Expressão SQL simples
   * const users = await new QueryBuilder<User>('users')
   *   .select(['id', 'name'])
   *   .selectRaw('UPPER(email) as email_upper')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Cálculos e funções
   * const userStats = await new QueryBuilder<User>('users')
   *   .select(['id', 'name'])
   *   .selectRaw('DATEDIFF(NOW(), created_at) as days_since_creation')
   *   .selectRaw('CASE WHEN last_login IS NULL THEN "Never" ELSE "Yes" END as has_logged_in')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Expressões complexas e subconsultas
   * const advancedStats = await new QueryBuilder<User>('users')
   *   .select(['id', 'name'])
   *   .selectRaw(`
   *     (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) as post_count
   *   `)
   *   .selectRaw(`
   *     (SELECT MAX(created_at) FROM comments WHERE comments.user_id = users.id) as last_comment_date
   *   `)
   *   .selectRaw(`
   *     CASE 
   *       WHEN (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) > 10 THEN 'Power User'
   *       WHEN (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) > 5 THEN 'Active User'
   *       ELSE 'Regular User'
   *     END as user_level
   *   `)
   *   .all();
   */
  selectRaw(sql: string): this { this.track('selectRaw', { sql }); this.selectColumns.push(raw(sql)); return this; }
  
  /**
   * Adiciona colunas de agregação à seleção.
   * Útil para incluir múltiplas funções de agregação em uma única consulta.
   * 
   * @param columns - Array de colunas de agregação a serem incluídas
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Múltiplas agregações
   * const stats = await new QueryBuilder<User>('users')
   *   .aggregatesSelect(['COUNT(*) as total_users', 'AVG(age) as avg_age'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Agregações com condições
   * const userMetrics = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .aggregatesSelect([
   *     'COUNT(*) as active_users',
   *     'SUM(CASE WHEN last_login > DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as recent_users'
   *   ])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de métricas complexo
   * class UserAnalytics {
   *   static async getComprehensiveMetrics(): Promise<any> {
   *     return await new QueryBuilder<User>('users')
   *       .aggregatesSelect([
   *         'COUNT(*) as total_users',
   *         'COUNT(CASE WHEN active = 1 THEN 1 END) as active_users',
   *         'COUNT(CASE WHEN role = "admin" THEN 1 END) as admin_count',
   *         'AVG(CASE WHEN last_login IS NOT NULL THEN DATEDIFF(NOW(), last_login) END) as avg_days_since_login',
   *         'MAX(created_at) as newest_user_date',
   *         'MIN(created_at) as oldest_user_date',
   *         'SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified_users',
   *         'ROUND((COUNT(CASE WHEN email_verified = 1 THEN 1 END) * 100.0 / COUNT(*)), 2) as verification_rate'
   *       ])
   *       .all();
   *   }
   * }
   */
  aggregatesSelect(columns: string[]): this { this.track('aggregatesSelect', { columns }); columns.forEach(c => this.selectColumns.push(c)); return this; }
  
  /**
   * Aplica DISTINCT à consulta para eliminar registros duplicados.
   * Útil quando se trabalha com dados que podem conter duplicatas.
   * 
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Eliminar duplicatas simples
   * const uniqueEmails = await new QueryBuilder<User>('users')
   *   .select(['email'])
   *   .distinct()
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - DISTINCT com múltiplas colunas
   * const uniqueCombinations = await new QueryBuilder<User>('users')
   *   .select(['city', 'state'])
   *   .distinct()
   *   .where('active', '=', true)
   *   .orderBy('city', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de dados únicos
   * class DataAnalyzer {
   *   static async findDuplicatePatterns(): Promise<any> {
   *     // Primeiro, encontramos todas as combinações únicas
   *     const uniquePatterns = await new QueryBuilder<User>('users')
   *       .select(['email_domain', 'registration_source', 'user_agent'])
   *       .distinct()
   *       .all();
   *     
   *     // Depois, comparamos com o total para encontrar padrões
   *     const totalCombinations = await new QueryBuilder<User>('users')
   *       .select(['email_domain', 'registration_source', 'user_agent'])
   *       .all();
   *     
   *     return {
   *       uniquePatterns: uniquePatterns.length,
   *       totalCombinations: totalCombinations.length,
   *       duplicateRate: ((totalCombinations.length - uniquePatterns.length) / totalCombinations.length * 100).toFixed(2)
   *     };
   *   }
   * }
   */
  distinct(): this { this.track('distinct'); this.isDistinct = true; return this; }

  /**
   * Adiciona uma cláusula WHERE básica à consulta.
   * Cria uma condição de filtro usando o operador especificado.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param operator - Operador de comparação SQL (ex: '=', '>', 'LIKE', etc.)
   * @param value - Valor para comparação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Filtro simples por igualdade
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições WHERE
   * const activeAdmins = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .where('role', '=', 'admin')
   *   .where('last_login', '>', new Date('2024-01-01'))
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros dinâmicos
   * class DynamicFilterBuilder {
   *   static buildUserFilter(filters: UserFilters): QueryBuilder<User> {
   *     let query = new QueryBuilder<User>('users');
   *     
   *     if (filters.active !== undefined) {
   *       query = query.where('active', '=', filters.active);
   *     }
   *     
   *     if (filters.role) {
   *       query = query.where('role', '=', filters.role);
   *     }
   *     
   *     if (filters.ageRange) {
   *       query = query.where('age', '>=', filters.ageRange.min)
   *                    .where('age', '<=', filters.ageRange.max);
   *     }
   *     
   *     if (filters.searchTerm) {
   *       query = query.where('name', 'LIKE', `%${filters.searchTerm}%`);
   *     }
   *     
   *     return query;
   *   }
   * }
   */
  where(column: keyof T | string, operator: Operator, value: any): this { this.track('where', { column, operator, value }); this.whereClauses.push({ type: 'basic', column, operator, value, logical: 'AND' }); return this; }
  
  /**
   * Adiciona uma cláusula OR WHERE à consulta.
   * Cria uma condição alternativa que será conectada com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param operator - Operador de comparação SQL
   * @param value - Valor para comparação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('role', '=', 'admin')
   *   .orWhere('role', '=', 'moderator')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR
   * const priorityUsers = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhere('role', '=', 'admin')
   *   .orWhere('last_login', '>', new Date('2024-01-01'))
   *   .orWhere('email', 'LIKE', '%@company.com')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de permissões complexo
   * class PermissionChecker {
   *   static async getUsersWithAccess(requiredPermissions: string[]): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Usuários com qualquer uma das permissões necessárias
   *     requiredPermissions.forEach(permission => {
   *       query = query.orWhere('permissions', 'LIKE', `%${permission}%`);
   *     });
   *     
   *     // OU usuários com role de super admin
   *     query = query.orWhere('role', '=', 'super_admin');
   *     
   *     // OU usuários com acesso de emergência
   *     query = query.orWhere('emergency_access', '=', true);
   *     
   *     return await query.all();
   *   }
   * }
   */
  orWhere(column: keyof T | string, operator: Operator, value: any): this { this.track('orWhere', { column, operator, value }); this.orWhereClauses.push({ type: 'basic', column, operator, value, logical: 'OR' }); return this; }
  
  /**
   * Adiciona uma cláusula WHERE condicionalmente.
   * Só aplica o filtro se a condição for verdadeira (não null, undefined ou string vazia).
   * 
   * @param condition - Condição que determina se o filtro será aplicado
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param operator - Operador de comparação SQL
   * @param value - Valor para comparação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Filtro condicional simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereIf(searchTerm, 'name', 'LIKE', `%${searchTerm}%`)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos filtros condicionais
   * const filteredUsers = await new QueryBuilder<User>('users')
   *   .whereIf(filters.role, 'role', '=', filters.role)
   *   .whereIf(filters.city, 'city', '=', filters.city)
   *   .whereIf(filters.minAge, 'age', '>=', filters.minAge)
   *   .whereIf(filters.maxAge, 'age', '<=', filters.maxAge)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros inteligente
   * class SmartFilterBuilder {
   *   static async buildAdvancedSearch(filters: AdvancedFilters): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users');
   *     
   *     // Filtros básicos sempre aplicados
   *     query = query.where('active', '=', true);
   *     
   *     // Filtros condicionais baseados em dados disponíveis
   *     query = query.whereIf(filters.name, 'name', 'LIKE', `%${filters.name}%`)
   *                  .whereIf(filters.email, 'email', 'LIKE', `%${filters.email}%`)
   *                  .whereIf(filters.phone, 'phone', 'LIKE', `%${filters.phone}%`);
   *     
   *     // Filtros de data condicionais
   *     if (filters.dateRange) {
   *       query = query.whereIf(filters.dateRange.start, 'created_at', '>=', filters.dateRange.start)
   *                    .whereIf(filters.dateRange.end, 'created_at', '<=', filters.dateRange.end);
   *     }
   *     
   *     // Filtros de localização condicionais
   *     if (filters.location) {
   *       query = query.whereIf(filters.location.country, 'country', '=', filters.location.country)
   *                    .whereIf(filters.location.state, 'state', '=', filters.location.state)
   *                    .whereIf(filters.location.city, 'city', '=', filters.location.city);
   *     }
   *     
   *     return await query.all();
   *   }
   * }
   */
  whereIf(condition: any, column: keyof T | string, operator: Operator, value: any): this { if (condition !== null && condition !== undefined && condition !== '') this.where(column, operator, value); return this; }
  
  /**
   * Adiciona múltiplas cláusulas WHERE baseadas em um objeto de condições.
   * Cada propriedade do objeto se torna uma condição WHERE com operador '='.
   * 
   * @param conditions - Objeto com pares chave-valor para criar condições WHERE
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Múltiplas condições simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereAll({ active: true, role: 'user' })
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Condições com filtros dinâmicos
   * const filterCriteria = { 
   *   active: true, 
   *   verified: true, 
   *   subscription_status: 'premium' 
   * };
   * 
   * const premiumUsers = await new QueryBuilder<User>('users')
   *   .whereAll(filterCriteria)
   *   .orderBy('created_at', 'DESC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros baseado em perfil
   * class ProfileBasedFilter {
   *   static async getUsersByProfile(profile: UserProfile): Promise<User[]> {
   *     // Filtros baseados no perfil do usuário
   *     const baseFilters: Partial<User> = {
   *       active: true,
   *       verified: true
   *     };
   *     
   *     // Adiciona filtros específicos baseados no perfil
   *     if (profile.preferences.includeInactive) {
   *       delete baseFilters.active;
   *     }
   *     
   *     if (profile.preferences.includeUnverified) {
   *       delete baseFilters.verified;
   *     }
   *     
   *     // Filtros de localização
   *     if (profile.location) {
   *       Object.assign(baseFilters, {
   *         country: profile.location.country,
   *         timezone: profile.location.timezone
   *       });
   *     }
   *     
   *     // Filtros de comportamento
   *     if (profile.behavior) {
   *       Object.assign(baseFilters, {
   *         last_activity: profile.behavior.minActivityLevel,
   *         engagement_score: profile.behavior.minEngagementScore
   *       });
   *     }
   *     
   *     return await new QueryBuilder<User>('users')
   *       .whereAll(baseFilters)
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(profile.preferences.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  whereAll(conditions: Partial<T>): this { for (const key in conditions) { const value = (conditions as any)[key]; this.whereIf(value, key, '=', value); } return this; }

  /**
   * Prepara uma operação de INSERT na tabela.
   * Os dados não são inseridos até que .make() seja chamado.
   * 
   * @param data - Dados a serem inseridos (objeto único ou array de objetos)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Inserir um usuário
   * const result = await new QueryBuilder<User>('users')
   *   .insert({ name: 'John Doe', email: 'john@example.com' })
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Inserir múltiplos usuários
   * const users = [
   *   { name: 'John Doe', email: 'john@example.com', role: 'user' },
   *   { name: 'Jane Smith', email: 'jane@example.com', role: 'admin' }
   * ];
   * 
   * const result = await new QueryBuilder<User>('users')
   *   .insert(users)
   *   .make();
   * 
   * @example
   * // Exemplo avançado - Sistema de importação em lote com validação
   * class BatchImporter {
   *   static async importUsersFromCSV(csvData: string[][]): Promise<ImportResult> {
   *     const headers = csvData[0];
   *     const rows = csvData.slice(1);
   *     
   *     const validUsers: Partial<User>[] = [];
   *     const errors: string[] = [];
   *     
   *     rows.forEach((row, index) => {
   *       try {
   *         const user = this.parseCSVRow(headers, row);
   *         if (this.validateUser(user)) {
   *           validUsers.push(user);
   *         } else {
   *           errors.push(`Row ${index + 2}: Invalid user data`);
   *         }
   *       } catch (error) {
   *         errors.push(`Row ${index + 2}: ${error.message}`);
   *       }
   *     });
   *     
   *     if (validUsers.length > 0) {
   *       const result = await new QueryBuilder<User>('users')
   *         .insert(validUsers)
   *         .make();
   *       
   *       return {
   *         success: true,
   *         inserted: result.changes,
   *         errors,
   *         lastInsertId: result.lastInsertRowid
   *       };
   *     }
   *     
   *     return { success: false, inserted: 0, errors, lastInsertId: 0 };
   *   }
   * }
   */
  insert(data: Partial<T> | Partial<T>[]): this { this.track('insert', { data }); const dataAsArray = Array.isArray(data) ? data : [data]; this.pendingAction = { type: 'insert', data: dataAsArray }; return this; }
  
  /**
   * Prepara uma operação de UPDATE na tabela.
   * Os dados não são atualizados até que .make() seja chamado.
   * Requer pelo menos uma cláusula WHERE para segurança.
   * 
   * @param data - Objeto com os campos e valores a serem atualizados
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Atualizar um usuário específico
   * const result = await new QueryBuilder<User>('users')
   *   .where('id', '=', 1)
   *   .update({ lastLogin: new Date(), loginCount: 5 })
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Atualização em lote com condições
   * const result = await new QueryBuilder<User>('users')
   *   .where('role', '=', 'user')
   *   .where('lastLogin', '<', new Date('2024-01-01'))
   *   .update({ 
   *     status: 'inactive',
   *     updatedAt: new Date(),
   *     deactivationReason: 'Inactive for more than 6 months'
   *   })
   *   .make();
   * 
   * @example
   * // Exemplo avançado - Sistema de auditoria com histórico
   * class AuditSystem {
   *   static async updateUserWithAudit(userId: number, updates: Partial<User>, auditor: string): Promise<void> {
   *     // Primeiro, registra o estado anterior
   *     const previousState = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .get();
   *     
   *     if (!previousState) {
   *       throw new Error(`User ${userId} not found`);
   *     }
   *     
   *     // Cria registro de auditoria
   *     await new QueryBuilder<AuditLog>('user_audit_logs')
   *       .insert({
   *         userId,
   *         action: 'UPDATE',
   *         previousState: JSON.stringify(previousState),
   *         newState: JSON.stringify({ ...previousState, ...updates }),
   *         auditor,
   *         timestamp: new Date(),
   *         ipAddress: this.getClientIP()
   *       })
   *       .make();
   *     
   *     // Executa a atualização
   *     const result = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .update({
   *         ...updates,
   *         updatedAt: new Date(),
   *         updatedBy: auditor
   *       })
   *       .make();
   *     
   *     if (result.changes === 0) {
   *       throw new Error('Update failed - no rows affected');
   *     }
   *   }
   * }
   */
  update(data: Partial<T>): this { this.track('update', { data }); this.pendingAction = { type: 'update', data }; return this; }
  
  /**
   * Prepara uma operação de DELETE na tabela.
   * Os registros não são deletados até que .make() seja chamado.
   * Requer pelo menos uma cláusula WHERE para segurança.
   * 
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Deletar um usuário específico
   * const result = await new QueryBuilder<User>('users')
   *   .where('id', '=', 1)
   *   .delete()
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Deletar usuários inativos
   * const result = await new QueryBuilder<User>('users')
   *   .where('active', '=', false)
   *   .where('lastLogin', '<', new Date('2020-01-01'))
   *   .delete()
   *   .make();
   * 
   * @example
   * // Exemplo avançado - Sistema de soft delete com backup
   * class SafeDeleteSystem {
   *   static async safeDeleteUser(userId: number, reason: string): Promise<void> {
   *     // Primeiro, faz backup dos dados
   *     const userData = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .get();
   *     
   *     if (!userData) {
   *       throw new Error(`User ${userId} not found`);
   *     }
   *     
   *     // Cria backup na tabela de arquivo
   *     await new QueryBuilder<DeletedUser>('deleted_users')
   *       .insert({
   *         originalId: userId,
   *         userData: JSON.stringify(userData),
   *         deletedAt: new Date(),
   *         deletedBy: this.getCurrentUser(),
   *         deletionReason: reason,
   *         backupLocation: 'deleted_users_table'
   *       })
   *       .make();
   *     
   *     // Executa o delete real
   *     const result = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .delete()
   *       .make();
   *     
   *     // Registra a operação no log de sistema
   *     await new QueryBuilder<SystemLog>('system_logs')
   *       .insert({
   *         action: 'USER_DELETED',
   *         targetId: userId,
   *         details: `User deleted with reason: ${reason}`,
   *         timestamp: new Date(),
   *         severity: 'INFO'
   *       })
   *       .make();
   *   }
   * }
   */
  delete(): this { this.track('delete'); this.pendingAction = { type: 'delete' }; return this; }
  
  /**
   * Prepara uma operação de UPDATE OR INSERT (upsert).
   * Tenta atualizar um registro existente, se não encontrar, insere um novo.
   * 
   * @param attributes - Atributos para identificar o registro (usado no WHERE)
   * @param values - Valores a serem inseridos/atualizados
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Upsert simples
   * const result = await new QueryBuilder<User>('users')
   *   .updateOrInsert(
   *     { email: 'john@example.com' }, // atributos para busca
   *     { name: 'John Doe', role: 'user' } // valores para inserir/atualizar
   *   )
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Upsert com múltiplos campos de identificação
   * const result = await new QueryBuilder<Order>('orders')
   *   .updateOrInsert(
   *     { userId: 123, productId: 456 }, // chave composta
   *     { 
   *       quantity: 2, 
   *       price: 29.99, 
   *       updatedAt: new Date() 
   *     }
   *   )
   *   .make();
   * 
   * @example
   * // Exemplo avançado - Sistema de sincronização de dados
   * class DataSynchronizer {
   *   static async syncUserProfile(externalData: ExternalUserProfile): Promise<SyncResult> {
   *     const attributes = {
   *       externalId: externalData.id,
   *       source: externalData.source
   *     };
   *     
   *     const values = {
   *       name: externalData.name,
   *       email: externalData.email,
   *       avatar: externalData.avatar,
   *       lastSync: new Date(),
   *       syncVersion: externalData.version,
   *       metadata: JSON.stringify(externalData.metadata)
   *     };
   *     
   *     // Tenta atualizar ou inserir
   *     const result = await new QueryBuilder<UserProfile>('user_profiles')
   *       .updateOrInsert(attributes, values)
   *       .make();
   *     
   *     // Se foi uma inserção, cria registros relacionados
   *     if (result.changes > 0 && result.lastInsertRowid) {
   *       await this.createRelatedRecords(result.lastInsertRowid, externalData);
   *     }
   *     
   *     return {
   *       success: true,
   *       action: result.changes > 0 ? 'INSERTED' : 'UPDATED',
   *       recordId: result.lastInsertRowid,
   *       timestamp: new Date()
   *     };
   *   }
   * }
   */
  updateOrInsert(attributes: Partial<T>, values: Partial<T> = {}): this { this.pendingAction = { type: 'updateOrInsert', data: { attributes, values } }; return this; }
  
  /**
   * Prepara uma operação de incremento de campo numérico.
   * Adiciona o valor especificado ao campo atual.
   * 
   * @param column - Nome da coluna numérica a ser incrementada
   * @param amount - Quantidade a ser adicionada (padrão: 1)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Incrementar contador de login
   * const result = await new QueryBuilder<User>('users')
   *   .where('id', '=', 1)
   *   .increment('loginCount')
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Incrementar com valor customizado
   * const result = await new QueryBuilder<Inventory>('inventory')
   *   .where('productId', '=', 123)
   *   .increment('stock', 10)
   *   .make();
   * 
   * @example
   * // Exemplo avançado - Sistema de pontos e gamificação
   * class GamificationSystem {
   *   static async awardPoints(userId: number, action: string, points: number): Promise<void> {
   *     // Incrementa pontos do usuário
   *     const result = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .increment('points', points)
   *       .make();
   *     
   *     // Registra a ação para histórico
   *     await new QueryBuilder<PointHistory>('point_history')
   *       .insert({
   *         userId,
   *         action,
   *         points,
   *         timestamp: new Date(),
   *         balance: await this.getCurrentBalance(userId)
   *       })
   *       .make();
   *     
   *     // Verifica se atingiu novo nível
   *     await this.checkLevelUpgrade(userId);
   *     
   *     // Notifica outros sistemas
   *     await this.notifyAchievement(userId, action, points);
   *   }
   * }
   */
  increment(column: keyof T, amount = 1): this { this.pendingAction = { type: 'increment', data: { column, amount } }; return this; }
  
  /**
   * Prepara uma operação de decremento de campo numérico.
   * Subtrai o valor especificado do campo atual.
   * 
   * @param column - Nome da coluna numérica a ser decrementada
   * @param amount - Quantidade a ser subtraída (padrão: 1)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Decrementar estoque
   * const result = await new QueryBuilder<Product>('products')
   *   .where('id', '=', 123)
   *   .decrement('stock')
   *   .make();
   * 
   * @example
   * // Exemplo intermediário - Decrementar com validação
   * const product = await new QueryBuilder<Product>('products')
   *   .where('id', '=', 123)
   *   .get();
   *   
   * if (product.stock >= 5) {
   *   const result = await new QueryBuilder<Product>('products')
   *     .where('id', '=', 123)
   *     .decrement('stock', 5)
   *     .make();
   * }
   * 
   * @example
   * // Exemplo avançado - Sistema de reservas com controle de concorrência
   * class ReservationSystem {
   *   static async reserveSeat(eventId: number, userId: number, seatNumber: string): Promise<ReservationResult> {
   *     // Verifica disponibilidade
   *     const seat = await new QueryBuilder<Seat>('seats')
   *       .where('eventId', '=', eventId)
   *       .where('seatNumber', '=', seatNumber)
   *       .where('status', '=', 'available')
   *       .get();
   *     
   *     if (!seat) {
   *       throw new Error('Seat not available');
   *     }
   *     
   *     // Decrementa capacidade disponível do evento
   *     const capacityResult = await new QueryBuilder<Event>('events')
   *       .where('id', '=', eventId)
   *       .decrement('availableCapacity')
   *       .make();
   *     
   *     if (capacityResult.changes === 0) {
   *       throw new Error('Event is full');
   *     }
   *     
   *     // Marca assento como reservado
   *     await new QueryBuilder<Seat>('seats')
   *       .where('id', '=', seat.id)
   *       .update({
   *         status: 'reserved',
   *         reservedBy: userId,
   *         reservedAt: new Date()
   *       })
   *       .make();
   *     
   *     // Cria a reserva
   *     const reservation = await new QueryBuilder<Reservation>('reservations')
   *       .insert({
   *         eventId,
   *         userId,
   *         seatId: seat.id,
   *         status: 'confirmed',
   *         createdAt: new Date()
   *       })
   *       .make();
   *     
   *     return {
   *       success: true,
   *       reservationId: reservation.lastInsertRowid,
   *       seatNumber,
   *       eventId
   *     };
   *   }
   * }
   */
  decrement(column: keyof T, amount = 1): this { this.pendingAction = { type: 'decrement', data: { column, amount } }; return this; }

  /**
   * Adiciona uma cláusula WHERE IN para verificar se um valor está em uma lista.
   * Útil para filtrar por múltiplos valores possíveis.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Array de valores para verificar
   * @param logical - Conectivo lógico ('AND' ou 'OR', padrão: 'AND')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Filtro IN simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereIn('role', ['admin', 'moderator', 'user'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos filtros IN
   * const users = await new QueryBuilder<User>('users')
   *   .whereIn('role', ['admin', 'moderator'])
   *   .whereIn('status', ['active', 'pending'])
   *   .whereIn('department', ['IT', 'HR', 'Sales'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros por categorias
   * class CategoryFilterSystem {
   *   static async getUsersByCategories(categories: string[], userPreferences: UserPreferences): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Filtra por categorias de interesse
   *     if (categories.length > 0) {
   *       query = query.whereIn('interest_category', categories);
   *     }
   *     
   *     // Filtra por níveis de acesso baseados nas preferências
   *     const accessLevels = this.calculateAccessLevels(userPreferences);
   *     query = query.whereIn('access_level', accessLevels);
   *     
   *     // Filtra por localizações disponíveis
   *     if (userPreferences.locationRestrictions) {
   *       query = query.whereIn('country', userPreferences.locationRestrictions.allowedCountries);
   *     }
   *     
   *     // Filtra por horários de disponibilidade
   *     const availableTimeSlots = this.getAvailableTimeSlots(userPreferences.timezone);
   *     query = query.whereIn('preferred_time_slot', availableTimeSlots);
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(userPreferences.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  whereIn(column: keyof T | string, values: any[], logical: 'AND' | 'OR' = 'AND'): this { this.whereClauses.push({ type: 'in', column, value: values, logical, not: false }); return this; }
  
  /**
   * Adiciona uma cláusula OR WHERE IN para verificar se um valor está em uma lista.
   * Conecta com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Array de valores para verificar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR IN simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhereIn('role', ['admin', 'super_admin'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR IN
   * const priorityUsers = await new QueryBuilder<User>('users')
   *   .where('verified', '=', true)
   *   .orWhereIn('role', ['admin', 'moderator'])
   *   .orWhereIn('subscription_type', ['premium', 'enterprise'])
   *   .orWhereIn('last_activity', ['today', 'yesterday'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de permissões hierárquicas
   * class HierarchicalPermissionSystem {
   *   static async getUsersWithAccess(requiredPermissions: string[], context: PermissionContext): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Usuários com permissões diretas
   *     query = query.orWhereIn('direct_permissions', requiredPermissions);
   *     
   *     // Usuários com roles que têm as permissões
   *     const rolesWithPermissions = await this.getRolesWithPermissions(requiredPermissions);
   *     query = query.orWhereIn('role', rolesWithPermissions);
   *     
   *     // Usuários em grupos com as permissões
   *     const groupsWithPermissions = await this.getGroupsWithPermissions(requiredPermissions);
   *     query = query.orWhereIn('group_id', groupsWithPermissions);
   *     
   *     // Usuários com permissões herdadas de hierarquia
   *     if (context.includeInherited) {
   *       const inheritedPermissions = await this.getInheritedPermissions(context.userId);
   *       query = query.orWhereIn('inherited_permissions', inheritedPermissions);
   *     }
   *     
   *     // Usuários com permissões temporárias
   *     if (context.includeTemporary) {
   *       const tempPermissions = await this.getTemporaryPermissions(requiredPermissions);
   *       query = query.orWhereIn('temp_permission_id', tempPermissions);
   *     }
   *     
   *     return await query
   *       .orderBy('permission_level', 'DESC')
   *       .limit(context.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  orWhereIn(column: keyof T | string, values: any[]): this { return this.whereIn(column, values, 'OR'); }
  
  /**
   * Adiciona uma cláusula WHERE NOT IN para verificar se um valor NÃO está em uma lista.
   * Exclui registros que correspondem aos valores especificados.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Array de valores para excluir
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Exclusão NOT IN simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereNotIn('role', ['admin', 'moderator'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas exclusões
   * const regularUsers = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereNotIn('role', ['admin', 'moderator', 'super_user'])
   *   .whereNotIn('status', ['banned', 'suspended'])
   *   .whereNotIn('email_domain', ['@test.com', '@example.com'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros de segurança
   * class SecurityFilterSystem {
   *   static async getSecureUserList(excludePatterns: SecurityPatterns): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Exclui usuários com roles sensíveis
   *     if (excludePatterns.sensitiveRoles) {
   *       query = query.whereNotIn('role', excludePatterns.sensitiveRoles);
   *     }
   *     
   *     // Exclui usuários de domínios suspeitos
   *     if (excludePatterns.suspiciousDomains) {
   *       query = query.whereNotIn('email_domain', excludePatterns.suspiciousDomains);
   *     }
   *     
   *     // Exclui usuários com padrões de comportamento suspeito
   *     if (excludePatterns.suspiciousBehaviors) {
   *       query = query.whereNotIn('behavior_pattern', excludePatterns.suspiciousBehaviors);
   *     }
   *     
   *     // Exclui usuários de localizações restritas
   *     if (excludePatterns.restrictedLocations) {
   *       query = query.whereNotIn('country', excludePatterns.restrictedLocations);
   *     }
   *     
   *     // Exclui usuários com histórico de violações
   *     if (excludePatterns.violationHistory) {
   *       const usersWithViolations = await this.getUsersWithViolations(excludePatterns.violationHistory);
   *       query = query.whereNotIn('id', usersWithViolations);
   *     }
   *     
   *     return await query
   *       .orderBy('security_score', 'ASC')
   *       .limit(excludePatterns.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  whereNotIn(column: keyof T | string, values: any[]): this { this.whereClauses.push({ type: 'in', column, value: values, logical: 'AND', not: true }); return this; }
  
  /**
   * Adiciona uma cláusula OR WHERE NOT IN para verificar se um valor NÃO está em uma lista.
   * Conecta com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Array de valores para excluir
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR NOT IN simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhereNotIn('role', ['admin', 'moderator'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR NOT IN
   * const specialUsers = await new QueryBuilder<User>('users')
   *   .where('verified', '=', true)
   *   .orWhereNotIn('subscription_type', ['free', 'basic'])
   *   .orWhereNotIn('last_activity', ['never', 'unknown'])
   *   .orWhereNotIn('email_domain', ['@temp.com', '@disposable.com'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de risco
   * class RiskAnalysisSystem {
   *   static async getLowRiskUsers(riskFactors: RiskFactors): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Usuários com baixo risco baseado em múltiplos critérios
   *     query = query.orWhereNotIn('risk_level', ['high', 'critical'])
   *                  .orWhereNotIn('suspicious_activity', ['yes', 'confirmed'])
   *                  .orWhereNotIn('fraud_score', [8, 9, 10])
   *                  .orWhereNotIn('verification_status', ['pending', 'failed'])
   *                  .orWhereNotIn('compliance_status', ['non_compliant', 'under_review']);
   *     
   *     // Exclui usuários com histórico de problemas
   *     const problematicUsers = await this.getProblematicUsers(riskFactors);
   *     query = query.whereNotIn('id', problematicUsers);
   *     
   *     // Exclui usuários de regiões de alto risco
   *     const highRiskRegions = await this.getHighRiskRegions();
   *     query = query.whereNotIn('region', highRiskRegions);
   *     
   *     return await query
   *       .orderBy('risk_score', 'ASC')
   *       .limit(riskFactors.maxResults || 200)
   *       .all();
   *   }
   * }
   */
  orWhereNotIn(column: keyof T | string, values: any[]): this { this.orWhereClauses.push({ type: 'in', column, value: values, logical: 'OR', not: true }); return this; }

  /**
   * Adiciona uma cláusula WHERE IS NULL para verificar se um campo é nulo.
   * Útil para encontrar registros com campos não preenchidos.
   * 
   * @param column - Nome da coluna ou chave do tipo T para verificar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar campos nulos
   * const users = await new QueryBuilder<User>('users')
   *   .whereNull('email')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos campos nulos
   * const incompleteUsers = await new QueryBuilder<User>('users')
   *   .whereNull('phone')
   *   .whereNull('address')
   *   .whereNull('profile_picture')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de validação de dados
   * class DataValidationSystem {
   *   static async getIncompleteProfiles(requiredFields: string[]): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Verifica campos obrigatórios que estão nulos
   *     requiredFields.forEach(field => {
   *       query = query.whereNull(field);
   *     });
   *     
   *     // Exclui usuários que já foram notificados
   *     query = query.whereNull('incomplete_profile_notification_sent');
   *     
   *     return await query
   *       .orderBy('created_at', 'ASC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereNull(column: keyof T | string): this { this.whereClauses.push({ type: 'null', column, logical: 'AND', not: false, value: undefined }); return this; }
  
  /**
   * Adiciona uma cláusula OR WHERE IS NULL para verificar se um campo é nulo.
   * Conecta com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para verificar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR NULL simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhereNull('email')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR NULL
   * const usersToContact = await new QueryBuilder<User>('users')
   *   .where('verified', '=', false)
   *   .orWhereNull('phone')
   *   .orWhereNull('address')
   *   .orWhereNull('emergency_contact')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de qualidade de dados
   * class DataQualityAnalyzer {
   *   static async getDataQualityIssues(qualityThresholds: QualityThresholds): Promise<DataQualityReport> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Usuários com dados críticos faltando
   *     const criticalFields = ['email', 'phone', 'identity_document'];
   *     criticalFields.forEach(field => {
   *       query = query.orWhereNull(field);
   *     });
   *     
   *     // Usuários com dados de segurança faltando
   *     const securityFields = ['two_factor_enabled', 'last_password_change', 'security_questions'];
   *     securityFields.forEach(field => {
   *       query = query.orWhereNull(field);
   *     });
   *     
   *     const usersWithIssues = await query.all();
   *     
   *     return {
   *       totalUsers: usersWithIssues.length,
   *       criticalIssues: usersWithIssues.filter(u => !u.email || !u.phone).length,
   *       securityIssues: usersWithIssues.filter(u => !u.two_factor_enabled).length,
   *       dataCompleteness: this.calculateCompleteness(usersWithIssues),
   *       recommendations: this.generateRecommendations(usersWithIssues)
   *     };
   *   }
   * }
   */
  orWhereNull(column: keyof T | string): this { this.orWhereClauses.push({ type: 'null', column, logical: 'OR', not: false, value: undefined }); return this; }
  
  /**
   * Adiciona uma cláusula WHERE IS NOT NULL para verificar se um campo não é nulo.
   * Útil para encontrar registros com campos preenchidos.
   * 
   * @param column - Nome da coluna ou chave do tipo T para verificar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar campos não nulos
   * const users = await new QueryBuilder<User>('users')
   *   .whereNotNull('email')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos campos não nulos
   * const completeUsers = await new QueryBuilder<User>('users')
   *   .whereNotNull('phone')
   *   .whereNotNull('address')
   *   .whereNotNull('profile_picture')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de segmentação de usuários
   * class UserSegmentationSystem {
   *   static async getHighValueUsers(segmentationCriteria: SegmentationCriteria): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true)
   *       .where('verified', '=', true);
   *     
   *     // Usuários com perfil completo
   *     const profileFields = ['bio', 'interests', 'skills', 'experience'];
   *     profileFields.forEach(field => {
   *       query = query.whereNotNull(field);
   *     });
   *     
   *     // Usuários com dados de pagamento
   *     const paymentFields = ['payment_method', 'billing_address', 'tax_id'];
   *     paymentFields.forEach(field => {
   *       query = query.whereNotNull(field);
   *     });
   *     
   *     // Usuários com histórico de atividade
   *     query = query.whereNotNull('last_activity')
   *                  .whereNotNull('engagement_score')
   *                  .whereNotNull('preferences');
   *     
   *     return await query
   *       .orderBy('engagement_score', 'DESC')
   *       .limit(segmentationCriteria.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  whereNotNull(column: keyof T | string): this { this.whereClauses.push({ type: 'null', column, logical: 'AND', not: true, value: undefined }); return this; }
  
  /**
   * Adiciona uma cláusula OR WHERE IS NOT NULL para verificar se um campo não é nulo.
   * Conecta com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para verificar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR NOT NULL simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhereNotNull('premium_subscription')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR NOT NULL
   * const qualifiedUsers = await new QueryBuilder<User>('users')
   *   .where('verified', '=', true)
   *   .orWhereNotNull('professional_certification')
   *   .orWhereNotNull('academic_degree')
   *   .orWhereNotNull('work_experience')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de recomendação inteligente
   * class RecommendationEngine {
   *   static async getPersonalizedRecommendations(userId: number, context: RecommendationContext): Promise<Recommendation[]> {
   *     const user = await new QueryBuilder<User>('users')
   *       .where('id', '=', userId)
   *       .get();
   *     
   *     if (!user) {
   *       throw new Error('User not found');
   *     }
   *     
   *     let query = new QueryBuilder<Content>('content')
   *       .where('published', '=', true);
   *     
   *     // Conteúdo baseado em interesses do usuário
   *     if (user.interests) {
   *       query = query.orWhereNotNull('interest_tags');
   *     }
   *     
   *     // Conteúdo baseado em localização
   *     if (user.location) {
   *       query = query.orWhereNotNull('location_tags');
   *     }
   *     
   *     // Conteúdo baseado em histórico de consumo
   *     if (user.viewing_history) {
   *       query = query.orWhereNotNull('similar_content_ids');
   *     }
   *     
   *     // Conteúdo baseado em preferências de idioma
   *     if (user.language_preferences) {
   *       query = query.orWhereNotNull('language_support');
   *     }
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(context.maxRecommendations || 20)
   *       .all();
   *   }
   * }
   */
  orWhereNotNull(column: keyof T | string): this { this.orWhereClauses.push({ type: 'null', column, logical: 'OR', not: true, value: undefined }); return this; }

  /**
   * Adiciona uma cláusula WHERE BETWEEN para verificar se um valor está em um intervalo.
   * Inclui os valores de início e fim do intervalo.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Tupla com [valor_inicio, valor_fim] do intervalo
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Filtro de intervalo simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereBetween('age', [18, 65])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos intervalos
   * const users = await new QueryBuilder<User>('users')
   *   .whereBetween('age', [18, 65])
   *   .whereBetween('salary', [30000, 100000])
   *   .whereBetween('experience_years', [1, 10])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros de preço dinâmicos
   * class DynamicPricingFilter {
   *   static async getProductsInPriceRange(
   *     category: string, 
   *     userPreferences: UserPreferences,
   *     marketConditions: MarketConditions
   *   ): Promise<Product[]> {
   *     // Calcula faixa de preço baseada no perfil do usuário
   *     const basePriceRange = this.calculateBasePriceRange(userPreferences.income, userPreferences.location);
   *     
   *     // Ajusta para condições de mercado
   *     const adjustedRange = this.adjustForMarketConditions(basePriceRange, marketConditions);
   *     
   *     // Aplica filtros de categoria e preço
   *     let query = new QueryBuilder<Product>('products')
   *       .where('category', '=', category)
   *       .where('active', '=', true)
   *       .whereBetween('price', adjustedRange);
   *     
   *     // Filtros adicionais baseados em preferências
   *     if (userPreferences.brandPreferences) {
   *       query = query.whereIn('brand', userPreferences.brandPreferences);
   *     }
   *     
   *     // Filtros de disponibilidade
   *     if (userPreferences.deliveryPreferences) {
   *       query = query.whereBetween('delivery_time', userPreferences.deliveryPreferences.timeRange);
   *     }
   *     
   *     // Filtros de avaliação
   *     if (userPreferences.minRating) {
   *       query = query.whereBetween('rating', [userPreferences.minRating, 5.0]);
   *     }
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(userPreferences.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  whereBetween(column: keyof T | string, values: [any, any]): this { this.whereClauses.push({ type: 'between', column, value: values, logical: 'AND', not: false }); return this; }
  
  /**
   * Adiciona uma cláusula WHERE NOT BETWEEN para verificar se um valor NÃO está em um intervalo.
   * Exclui registros dentro do intervalo especificado.
   * 
   * @param column - Nome da coluna ou chave do tipo T para filtrar
   * @param values - Tupla com [valor_inicio, valor_fim] do intervalo a ser excluído
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Excluir intervalo simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereNotBetween('age', [13, 17]) // Exclui menores de idade
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas exclusões de intervalo
   * const users = await new QueryBuilder<User>('users')
   *   .whereNotBetween('age', [13, 17])
   *   .whereNotBetween('salary', [0, 20000]) // Exclui salários muito baixos
   *   .whereNotBetween('experience_years', [0, 0.5]) // Exclui muito inexperientes
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros de segurança financeira
   * class FinancialSecurityFilter {
   *   static async getSecureFinancialUsers(securityCriteria: SecurityCriteria): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('verified', '=', true)
   *       .where('active', '=', true);
   *     
   *     // Exclui usuários com salários muito baixos (risco de fraude)
   *     query = query.whereNotBetween('monthly_income', [0, securityCriteria.minIncomeThreshold]);
   *     
   *     // Exclui usuários com histórico de crédito muito baixo
   *     query = query.whereNotBetween('credit_score', [0, securityCriteria.minCreditScore]);
   *     
   *     // Exclui usuários com muitas transações suspeitas
   *     query = query.whereNotBetween('suspicious_transaction_count', [securityCriteria.maxSuspiciousTransactions, 999999]);
   *     
   *     // Exclui usuários com padrões de gastos anômalos
   *     query = query.whereNotBetween('monthly_spending_variance', [0, securityCriteria.maxSpendingVariance]);
   *     
   *     // Exclui usuários com muitas contas bancárias (potencial fraude)
   *     query = query.whereNotBetween('bank_account_count', [securityCriteria.maxBankAccounts, 999999]);
   *     
   *     return await query
   *       .orderBy('security_score', 'DESC')
   *       .limit(securityCriteria.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  whereNotBetween(column: keyof T | string, values: [any, any]): this { this.whereClauses.push({ type: 'between', column, value: values, logical: 'AND', not: true }); return this; }
  
  /**
   * Adiciona uma cláusula WHERE para comparar duas colunas da mesma tabela.
   * Útil para comparações entre campos relacionados.
   * 
   * @param firstColumn - Primeira coluna para comparação
   * @param operator - Operador de comparação SQL
   * @param secondColumn - Segunda coluna para comparação
   * @param logical - Conectivo lógico ('AND' ou 'OR', padrão: 'AND')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Comparação simples entre colunas
   * const users = await new QueryBuilder<User>('users')
   *   .whereColumn('created_at', '<', 'last_login')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas comparações entre colunas
   * const users = await new QueryBuilder<User>('users')
   *   .whereColumn('created_at', '<', 'last_login')
   *   .whereColumn('last_login', '>', 'updated_at')
   *   .whereColumn('login_count', '>', 'failed_login_count')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de comportamento temporal
   * class TemporalBehaviorAnalyzer {
   *   static async getAnomalousBehaviorUsers(analysisPeriod: DateRange): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Usuários que criaram conta antes do primeiro login (anômalo)
   *     query = query.whereColumn('created_at', '>', 'first_login_date');
   *     
   *     // Usuários que atualizaram perfil antes de verificar email (anômalo)
   *     query = query.whereColumn('profile_updated_at', '<', 'email_verified_at');
   *     
   *     // Usuários com último login anterior à última atualização (inconsistente)
   *     query = query.whereColumn('last_login', '<', 'last_profile_update');
   *     
   *     // Usuários que mudaram senha antes de fazer login (suspeito)
   *     query = query.whereColumn('password_changed_at', '>', 'last_login');
   *     
   *     // Usuários com atividade recente mas sem login (possível bot)
   *     query = query.whereColumn('last_activity', '>', 'last_login');
   *     
   *     // Filtra por período de análise
   *     query = query.whereBetween('created_at', [analysisPeriod.start, analysisPeriod.end]);
   *     
   *     return await query
   *       .orderBy('anomaly_score', 'DESC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereColumn(firstColumn: keyof T | string, operator: Operator, secondColumn: keyof T | string, logical: 'AND' | 'OR' = 'AND'): this { this.whereClauses.push({ type: 'column', column: firstColumn, operator, value: secondColumn, logical }); return this; }

  /**
   * Adiciona uma cláusula WHERE com SQL raw customizado.
   * Permite expressões SQL complexas que não são suportadas pelos métodos padrão.
   * 
   * @param sql - Expressão SQL raw para a cláusula WHERE
   * @param bindings - Array de valores para os placeholders na SQL
   * @param logical - Conectivo lógico ('AND' ou 'OR', padrão: 'AND')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - SQL raw simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereRaw('LENGTH(name) > 10')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - SQL raw com bindings
   * const users = await new QueryBuilder<User>('users')
   *   .whereRaw('created_at BETWEEN ? AND ?', [startDate, endDate])
   *   .whereRaw('JSON_EXTRACT(metadata, "$.preferences.notifications") = ?', [true])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca geoespacial
   * class GeospatialSearchSystem {
   *   static async getUsersNearLocation(
   *     latitude: number, 
   *     longitude: number, 
   *     radiusKm: number,
   *     filters: LocationFilters
   *   ): Promise<User[]> {
   *     // Fórmula Haversine para cálculo de distância
   *     const haversineFormula = `
   *       (6371 * acos(
   *         cos(radians(?)) * cos(radians(latitude)) * 
   *         cos(radians(longitude) - radians(?)) + 
   *         sin(radians(?)) * sin(radians(latitude))
   *       )) <= ?
   *     `;
   *     
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true)
   *       .whereRaw(haversineFormula, [latitude, longitude, latitude, radiusKm]);
   *     
   *     // Filtros adicionais baseados em preferências de localização
   *     if (filters.timezone) {
   *       query = query.whereRaw('timezone = ?', [filters.timezone]);
   *     }
   *     
   *     // Filtros de horário de funcionamento
   *     if (filters.businessHours) {
   *       query = query.whereRaw(`
   *         JSON_EXTRACT(business_hours, "$.${filters.businessHours.day}") IS NOT NULL
   *         AND JSON_EXTRACT(business_hours, "$.${filters.businessHours.day}.open") <= ?
   *         AND JSON_EXTRACT(business_hours, "$.${filters.businessHours.day}.close") >= ?
   *       `, [filters.businessHours.currentTime, filters.businessHours.currentTime]);
   *     }
   *     
   *     // Filtros de idiomas falados
   *     if (filters.languages) {
   *       const languageConditions = filters.languages.map(lang => 
   *         `JSON_CONTAINS(languages, '"${lang}"')`
   *       ).join(' OR ');
   *       query = query.whereRaw(`(${languageConditions})`);
   *     }
   *     
   *     // Filtros de serviços disponíveis
   *     if (filters.services) {
   *       const serviceConditions = filters.services.map(service => 
   *         `JSON_EXTRACT(services, "$.${service}.available") = true`
   *       ).join(' AND ');
   *       query = query.whereRaw(`(${serviceConditions})`);
   *     }
   *     
   *     return await query
   *       .orderByRaw(`
   *         (6371 * acos(
   *           cos(radians(?)) * cos(radians(latitude)) * 
   *           cos(radians(longitude) - radians(?)) + 
   *           sin(radians(?)) * sin(radians(latitude))
   *         ))
   *       `, [latitude, longitude, latitude])
   *       .limit(filters.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  whereRaw(sql: string, bindings: any[] = [], logical: 'AND' | 'OR' = 'AND'): this { this.whereClauses.push({ type: 'raw', sql, logical, value: bindings } as any); return this; }
  
  /**
   * Adiciona uma cláusula WHERE para busca em texto em múltiplas colunas.
   * Cria uma condição LIKE com wildcards para cada coluna especificada.
   * 
   * @param searchTerm - Termo de busca a ser procurado
   * @param columns - Array de colunas onde buscar o termo
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca simples em múltiplas colunas
   * const users = await new QueryBuilder<User>('users')
   *   .whereRawSearch('john', ['name', 'email', 'username'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca com filtros adicionais
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereRawSearch('developer', ['title', 'skills', 'bio'])
   *   .whereRawSearch('javascript', ['skills', 'experience', 'interests'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca semântica inteligente
   * class SemanticSearchSystem {
   *   static async searchUsersByContext(
   *     searchContext: SearchContext,
   *     userPreferences: UserPreferences
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Busca principal baseada no contexto
   *     if (searchContext.primaryTerm) {
   *       const primaryColumns = ['name', 'title', 'company', 'bio'];
   *       query = query.whereRawSearch(searchContext.primaryTerm, primaryColumns);
   *     }
   *     
   *     // Busca por habilidades técnicas
   *     if (searchContext.technicalSkills) {
   *       const skillColumns = ['skills', 'certifications', 'experience', 'projects'];
   *       searchContext.technicalSkills.forEach(skill => {
   *         query = query.whereRawSearch(skill, skillColumns);
   *       });
   *     }
   *     
   *     // Busca por interesses e hobbies
   *     if (searchContext.interests) {
   *       const interestColumns = ['interests', 'hobbies', 'bio', 'social_media'];
   *       searchContext.interests.forEach(interest => {
   *         query = query.whereRawSearch(interest, interestColumns);
   *       });
   *     }
   *     
   *     // Busca por localização e disponibilidade
   *     if (searchContext.location) {
   *       const locationColumns = ['city', 'state', 'country', 'timezone', 'availability'];
   *       query = query.whereRawSearch(searchContext.location, locationColumns);
   *     }
   *     
   *     // Busca por experiência e histórico
   *     if (searchContext.experience) {
   *       const experienceColumns = ['work_history', 'education', 'achievements', 'references'];
   *       query = query.whereRawSearch(searchContext.experience, experienceColumns);
   *     }
   *     
   *     // Filtros baseados nas preferências do usuário
   *     if (userPreferences.excludeInactive) {
   *       query = query.where('last_activity', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
   *     }
   *     
   *     if (userPreferences.requireVerification) {
   *       query = query.where('verified', '=', true);
   *     }
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(userPreferences.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  whereRawSearch(searchTerm: string, columns: (keyof T | string)[]): this { if (!searchTerm) return this; const searchConditions = columns.map(col => `${String(col)} LIKE ?`).join(' OR '); const bindings = columns.map(() => `%${searchTerm}%`); return this.whereRaw(`(${searchConditions})`, bindings); }
  
  /**
   * Adiciona uma cláusula WHERE EXISTS para verificar se uma subconsulta retorna resultados.
   * Útil para consultas relacionais e verificações de existência.
   * 
   * @param query - QueryBuilder da subconsulta a ser verificada
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar existência simples
   * const usersWithPosts = await new QueryBuilder<User>('users')
   *   .whereExists(
   *     new QueryBuilder<Post>('posts').whereColumn('posts.user_id', '=', 'users.id')
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas verificações de existência
   * const activeUsersWithContent = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereExists(
   *     new QueryBuilder<Post>('posts')
   *       .whereColumn('posts.user_id', '=', 'users.id')
   *       .where('posts.published', '=', true)
   *   )
   *   .whereExists(
   *     new QueryBuilder<Comment>('comments')
   *       .whereColumn('comments.user_id', '=', 'users.id')
   *       .where('comments.created_at', '>', new Date('2024-01-01'))
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de engajamento complexo
   * class EngagementAnalysisSystem {
   *   static async getHighEngagementUsers(
   *     engagementCriteria: EngagementCriteria,
   *     timeRange: DateRange
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true)
   *       .where('verified', '=', true);
   *     
   *     // Usuários com posts publicados no período
   *     query = query.whereExists(
   *       new QueryBuilder<Post>('posts')
   *         .whereColumn('posts.user_id', '=', 'users.id')
   *         .where('posts.published', '=', true)
   *         .whereBetween('posts.created_at', [timeRange.start, timeRange.end])
   *         .where('posts.status', '=', 'published')
   *     );
   *     
   *     // Usuários com comentários significativos
   *     query = query.whereExists(
   *       new QueryBuilder<Comment>('comments')
   *         .whereColumn('comments.user_id', '=', 'users.id')
   *         .where('comments.approved', '=', true)
   *         .whereBetween('comments.created_at', [timeRange.start, timeRange.end])
   *         .whereRaw('LENGTH(comments.content) > ?', [engagementCriteria.minCommentLength])
   *     );
   *     
   *     // Usuários com interações sociais
   *     query = query.whereExists(
   *       new QueryBuilder<SocialInteraction>('social_interactions')
   *         .whereColumn('social_interactions.user_id', '=', 'users.id')
   *         .whereBetween('social_interactions.created_at', [timeRange.start, timeRange.end])
   *         .whereIn('social_interactions.type', ['like', 'share', 'bookmark'])
   *     );
   *     
   *     // Usuários com participação em eventos
   *     query = query.whereExists(
   *       new QueryBuilder<EventParticipation>('event_participations')
   *         .whereColumn('event_participations.user_id', '=', 'users.id')
   *         .whereBetween('event_participations.created_at', [timeRange.start, timeRange.end])
   *         .where('event_participations.status', '=', 'confirmed')
   *     );
   *     
   *     // Usuários com contribuições para a comunidade
   *     query = query.whereExists(
   *       new QueryBuilder<CommunityContribution>('community_contributions')
   *         .whereColumn('community_contributions.user_id', '=', 'users.id')
   *         .whereBetween('community_contributions.created_at', [timeRange.start, timeRange.end])
   *         .whereIn('community_contributions.type', ['moderation', 'help', 'translation'])
   *     );
   *     
   *     return await query
   *       .orderBy('engagement_score', 'DESC')
   *       .limit(engagementCriteria.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  whereExists(query: QueryBuilder<any>): this { this.whereClauses.push({ type: 'exists', query, logical: 'AND', not: false, value: undefined }); return this; }
  
  /**
   * Adiciona uma cláusula WHERE NOT EXISTS para verificar se uma subconsulta NÃO retorna resultados.
   * Útil para encontrar registros que não possuem relacionamentos específicos.
   * 
   * @param query - QueryBuilder da subconsulta a ser verificada
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar não existência simples
   * const usersWithoutPosts = await new QueryBuilder<User>('users')
   *   .whereNotExists(
   *     new QueryBuilder<Post>('posts').whereColumn('posts.user_id', '=', 'users.id')
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas verificações de não existência
   * const inactiveUsers = await new QueryBuilder<User>('users')
   *   .where('active', '=', false)
   *   .whereNotExists(
   *     new QueryBuilder<Login>('logins')
   *       .whereColumn('logins.user_id', '=', 'users.id')
   *       .where('logins.created_at', '>', new Date('2024-01-01'))
   *   )
   *   .whereNotExists(
   *     new QueryBuilder<Activity>('activities')
   *       .whereColumn('activities.user_id', '=', 'users.id')
   *       .where('activities.created_at', '>', new Date('2024-01-01'))
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de limpeza de dados órfãos
   * class OrphanedDataCleanupSystem {
   *   static async getOrphanedRecords(
   *     cleanupCriteria: CleanupCriteria,
   *     retentionPolicy: RetentionPolicy
   *   ): Promise<CleanupReport> {
   *     const report: CleanupReport = {
   *       orphanedUsers: [],
   *       orphanedPosts: [],
   *       orphanedComments: [],
   *       orphanedFiles: [],
   *       totalSpaceToFree: 0
   *     };
   *     
   *     // Usuários sem atividade recente e sem relacionamentos
   *     const orphanedUsers = await new QueryBuilder<User>('users')
   *       .where('active', '=', false)
   *       .where('last_activity', '<', new Date(Date.now() - retentionPolicy.userInactivityDays * 24 * 60 * 60 * 1000))
   *       .whereNotExists(
   *         new QueryBuilder<Post>('posts')
   *           .whereColumn('posts.user_id', '=', 'users.id')
   *           .where('posts.created_at', '>', new Date(Date.now() - retentionPolicy.contentRetentionDays * 24 * 60 * 60 * 1000))
   *       )
   *       .whereNotExists(
   *         new QueryBuilder<Comment>('comments')
   *           .whereColumn('comments.user_id', '=', 'users.id')
   *           .where('comments.created_at', '>', new Date(Date.now() - retentionPolicy.contentRetentionDays * 24 * 60 * 60 * 1000))
   *       )
   *       .whereNotExists(
   *         new QueryBuilder<File>('files')
   *           .whereColumn('files.user_id', '=', 'users.id')
   *       )
   *       .all();
   *     
   *     // Posts sem usuário ativo
   *     const orphanedPosts = await new QueryBuilder<Post>('posts')
   *       .whereNotExists(
   *         new QueryBuilder<User>('users')
   *           .whereColumn('users.id', '=', 'posts.user_id')
   *           .where('users.active', '=', true)
   *       )
   *       .where('posts.created_at', '<', new Date(Date.now() - retentionPolicy.contentRetentionDays * 24 * 60 * 60 * 1000))
   *       .all();
   *     
   *     // Comentários sem post ativo
   *     const orphanedComments = await new QueryBuilder<Comment>('comments')
   *       .whereNotExists(
   *         new QueryBuilder<Post>('posts')
   *           .whereColumn('posts.id', '=', 'comments.post_id')
   *           .where('posts.status', '=', 'published')
   *       )
   *       .where('comments.created_at', '<', new Date(Date.now() - retentionPolicy.contentRetentionDays * 24 * 60 * 60 * 1000))
   *       .all();
   *     
   *     // Arquivos sem referências ativas
   *     const orphanedFiles = await new QueryBuilder<File>('files')
   *       .whereNotExists(
   *         new QueryBuilder<Post>('posts')
   *           .whereRaw('JSON_CONTAINS(posts.attachments, CAST(files.id AS JSON))')
   *       )
   *       .whereNotExists(
   *         new QueryBuilder<User>('users')
   *           .whereColumn('users.avatar_id', '=', 'files.id')
   *       )
   *       .where('files.created_at', '<', new Date(Date.now() - retentionPolicy.fileRetentionDays * 24 * 60 * 60 * 1000))
   *       .all();
   *     
   *     // Calcula espaço total a ser liberado
   *     const totalSize = orphanedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
   *     
   *     return {
   *       orphanedUsers,
   *       orphanedPosts,
   *       orphanedComments,
   *       orphanedFiles,
   *       totalSpaceToFree: totalSize
   *     };
   *   }
   * }
   */
  whereNotExists(query: QueryBuilder<any>): this { this.whereClauses.push({ type: 'exists', query, logical: 'AND', not: true, value: undefined }); return this; }

  /**
   * Aplica uma callback condicionalmente se a condição for verdadeira.
   * Permite construir queries dinâmicas baseadas em condições.
   * 
   * @param condition - Condição que determina se a callback será executada
   * @param callback - Função que recebe a instância atual do QueryBuilder e o valor da condição
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição simples
   * const users = await new QueryBuilder<User>('users')
   *   .when(searchTerm, (query, term) => {
   *     query.whereRawSearch(term, ['name', 'email', 'bio']);
   *   })
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições
   * const users = await new QueryBuilder<User>('users')
   *   .when(filters.role, (query, role) => {
   *     query.where('role', '=', role);
   *   })
   *   .when(filters.location, (query, location) => {
   *     query.where('city', '=', location.city)
   *          .where('state', '=', location.state);
   *   })
   *   .when(filters.ageRange, (query, range) => {
   *     query.whereBetween('age', [range.min, range.max]);
   *   })
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros dinâmicos complexo
   * class AdvancedFilterBuilder {
   *   static async buildDynamicQuery(
   *     baseFilters: BaseFilters,
   *     dynamicFilters: DynamicFilters,
   *     userContext: UserContext
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Filtros base sempre aplicados
   *     if (baseFilters.verified) {
   *       query = query.where('verified', '=', true);
   *     }
   *     
   *     // Filtros dinâmicos baseados em contexto
   *     query = query
   *       .when(dynamicFilters.searchTerm, (q, term) => {
   *         q.whereRawSearch(term, ['name', 'email', 'bio', 'skills']);
   *       })
   *       .when(dynamicFilters.location, (q, location) => {
   *         q.where('country', '=', location.country);
   *         if (location.state) {
   *           q.where('state', '=', location.state);
   *         }
   *         if (location.city) {
   *           q.where('city', '=', location.city);
   *         }
   *       })
   *       .when(dynamicFilters.skills, (q, skills) => {
   *         skills.forEach(skill => {
   *           q.whereRawSearch(skill, ['skills', 'experience', 'certifications']);
   *         });
   *       })
   *       .when(dynamicFilters.experience, (q, exp) => {
   *         q.whereBetween('experience_years', [exp.min, exp.max]);
   *       })
   *       .when(dynamicFilters.salary, (q, salary) => {
   *         q.whereBetween('expected_salary', [salary.min, salary.max]);
   *       })
   *       .when(dynamicFilters.availability, (q, availability) => {
   *         q.where('availability_status', '=', availability.status);
   *         if (availability.startDate) {
   *           q.where('available_from', '<=', availability.startDate);
   *         }
   *       })
   *       .when(dynamicFilters.languages, (q, languages) => {
   *         languages.forEach(lang => {
   *           q.whereRaw(`JSON_CONTAINS(languages, '"${lang}"')`);
   *         });
   *       })
   *       .when(dynamicFilters.remote, (q, remote) => {
   *         if (remote.preferred) {
   *           q.where('remote_work', '=', true);
   *         }
   *       })
   *       .when(userContext.preferences, (q, prefs) => {
   *         if (prefs.excludeInactive) {
   *           q.where('last_activity', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
   *         }
   *         if (prefs.requirePortfolio) {
   *           q.whereNotNull('portfolio_url');
   *         }
   *       });
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(dynamicFilters.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  when(condition: any, callback: (query: this, value: any) => void): this { if (condition) callback(this, condition); return this; }
  
  /**
   * Aplica uma callback condicionalmente se a condição for falsa.
   * Oposto do método .when(), útil para casos onde queremos aplicar lógica quando algo NÃO é verdadeiro.
   * 
   * @param condition - Condição que determina se a callback será executada (executa quando falsa)
   * @param callback - Função que recebe a instância atual do QueryBuilder e o valor da condição
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição inversa simples
   * const users = await new QueryBuilder<User>('users')
   *   .unless(user.isAdmin, (query) => {
   *     query.where('active', '=', true); // Apenas usuários ativos para não-admins
   *   })
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições inversas
   * const users = await new QueryBuilder<User>('users')
   *   .unless(filters.includeInactive, (query) => {
   *     query.where('active', '=', true);
   *   })
   *   .unless(filters.includeUnverified, (query) => {
   *     query.where('verified', '=', true);
   *   })
   *   .unless(filters.includeSuspended, (query) => {
   *     query.where('status', '!=', 'suspended');
   *   })
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de permissões baseado em contexto
   * class ContextualPermissionSystem {
   *   static async getUsersWithContextualAccess(
   *     requestedAccess: AccessRequest,
   *     userContext: UserContext,
   *     systemContext: SystemContext
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Aplica restrições baseadas no contexto do usuário
   *     query = query
   *       .unless(userContext.hasFullAccess, (q) => {
   *         q.where('role', '!=', 'super_admin');
   *       })
   *       .unless(userContext.canViewSensitiveData, (q) => {
   *         q.where('sensitivity_level', '<=', userContext.maxSensitivityLevel);
   *       })
   *       .unless(userContext.canViewFinancialData, (q) => {
   *         q.whereNotIn('role', ['accountant', 'financial_analyst', 'treasurer']);
   *       })
   *       .unless(userContext.canViewPersonalData, (q) => {
   *         q.select(['id', 'name', 'role', 'department']); // Limita colunas sensíveis
   *       })
   *       .unless(userContext.canViewHistoricalData, (q) => {
   *         q.where('created_at', '>', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
   *       })
   *       .unless(systemContext.allowCrossDepartmentAccess, (q) => {
   *         q.where('department', '=', userContext.department);
   *       })
   *       .unless(systemContext.allowCrossRegionAccess, (q) => {
   *         q.where('region', '=', userContext.region);
   *       })
   *       .unless(systemContext.allowCrossTimeZoneAccess, (q) => {
   *         q.where('timezone', '=', userContext.timezone);
   *       });
   *     
   *     // Aplica filtros específicos da requisição
   *     if (requestedAccess.specificRoles) {
   *       query = query.whereIn('role', requestedAccess.specificRoles);
   *     }
   *     
   *     if (requestedAccess.specificDepartments) {
   *       query = query.whereIn('department', requestedAccess.specificDepartments);
   *     }
   *     
   *     return await query
   *       .orderBy('name', 'ASC')
   *       .limit(requestedAccess.maxResults || 100)
   *       .all();
   *   }
   * }
   */
  unless(condition: any, callback: (query: this, value: any) => void): this { if (!condition) callback(this, condition); return this; }
  
  /**
   * Cria uma cópia completa da instância atual do QueryBuilder.
   * Útil para criar variações de uma query sem afetar a original.
   * 
   * @returns Nova instância do QueryBuilder com todas as configurações copiadas
   * 
   * @example
   * // Exemplo básico - Clonar query simples
   * const baseQuery = new QueryBuilder<User>('users')
   *   .where('active', '=', true);
   *   
   * const adminQuery = baseQuery.clone()
   *   .where('role', '=', 'admin');
   *   
   * const userQuery = baseQuery.clone()
   *   .where('role', '=', 'user');
   * 
   * @example
   * // Exemplo intermediário - Clonar com modificações
   * const baseQuery = new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .where('active', '=', true);
   *   
   * const detailedQuery = baseQuery.clone()
   *   .select(['id', 'name', 'email', 'phone', 'address', 'bio'])
   *   .where('verified', '=', true);
   *   
   * const summaryQuery = baseQuery.clone()
   *   .select(['id', 'name'])
   *   .limit(10);
   * 
   * @example
   * // Exemplo avançado - Sistema de queries em lote com variações
   * class BatchQueryProcessor {
   *   static async processMultipleUserSegments(
   *     baseFilters: BaseFilters,
   *     segmentConfigs: SegmentConfig[]
   *   ): Promise<SegmentResults> {
   *     const baseQuery = new QueryBuilder<User>('users')
   *       .where('active', '=', true)
   *       .where('verified', '=', true);
   *     
   *     const results: SegmentResults = {};
   *     
   *     // Processa cada segmento em paralelo
   *     const segmentPromises = segmentConfigs.map(async (config) => {
   *       const segmentQuery = baseQuery.clone();
   *       
   *       // Aplica filtros específicos do segmento
   *       if (config.ageRange) {
   *         segmentQuery.whereBetween('age', [config.ageRange.min, config.ageRange.max]);
   *       }
   *       
   *       if (config.location) {
   *         segmentQuery.where('country', '=', config.location.country);
   *         if (config.location.state) {
   *           segmentQuery.where('state', '=', config.location.state);
   *         }
   *       }
   *       
   *       if (config.skills) {
   *         config.skills.forEach(skill => {
   *           segmentQuery.whereRawSearch(skill, ['skills', 'experience']);
   *         });
   *       }
   *       
   *       if (config.experience) {
   *         segmentQuery.whereBetween('experience_years', [config.experience.min, config.experience.max]);
   *       }
   *       
   *       // Aplica ordenação específica do segmento
   *       if (config.sortBy) {
   *         segmentQuery.orderBy(config.sortBy.field, config.sortBy.direction);
   *       }
   *       
   *       // Aplica limite específico do segmento
   *       if (config.maxResults) {
   *         segmentQuery.limit(config.maxResults);
   *       }
   *       
   *       // Executa a query do segmento
   *       const segmentUsers = await segmentQuery.all();
   *       
   *       // Calcula métricas do segmento
   *       const metrics = this.calculateSegmentMetrics(segmentUsers, config);
   *       
   *       return {
   *         segmentId: config.id,
   *         users: segmentUsers,
   *         metrics,
   *         query: segmentQuery.toSql() // Para auditoria
   *       };
   *     });
   *     
   *     const segmentResults = await Promise.all(segmentPromises);
   *     
   *     // Organiza resultados por segmento
   *     segmentResults.forEach(result => {
   *       results[result.segmentId] = result;
   *     });
   *     
   *     return results;
   *   }
   * }
   */
  /**
   * Cria uma cópia exata da instância atual do QueryBuilder.
   * Útil para reutilizar queries base ou criar variações.
   * 
   * @returns Nova instância do QueryBuilder com as mesmas configurações
   * 
   * @example
   * // Exemplo básico - Clonar query simples
   * const baseQuery = new QueryBuilder<User>('users')
   *   .where('active', '=', true);
   * 
   * const adminQuery = baseQuery.clone()
   *   .where('role', '=', 'admin');
   * 
   * const userQuery = baseQuery.clone()
   *   .where('role', '=', 'user');
   * 
   * @example
   * // Exemplo intermediário - Clonar com modificações
   * const baseQuery = new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .leftJoin('profiles', 'users.id = profiles.user_id')
   *   .where('users.active', '=', true);
   * 
   * const verifiedUsers = baseQuery.clone()
   *   .where('users.verified', '=', true)
   *   .all();
   * 
   * const unverifiedUsers = baseQuery.clone()
   *   .where('users.verified', '=', false)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de query templates
   * class QueryTemplateSystem {
   *   private static queryTemplates = new Map<string, QueryBuilder<any>>();
   *   
   *   static registerTemplate<T>(
   *     name: string,
   *     template: QueryBuilder<T>
   *   ): void {
   *     this.queryTemplates.set(name, template);
   *     this.queryTemplates.set(name, template);
   *   }
   *   
   *   static async executeTemplate<T>(
   *     templateName: string,
   *     customizations: QueryCustomization<T>
   *   ): Promise<T[]> {
   *     const template = this.queryTemplates.get(templateName);
   *     if (!template) {
   *       throw new Error(`Template '${templateName}' not found`);
   *     }
   *     
   *     // Clona o template base
   *     let query = template.clone();
   *     
   *     // Aplica customizações
   *     if (customizations.additionalSelects) {
   *       query = query.select(customizations.additionalSelects);
   *     }
   *     
   *     if (customizations.additionalJoins) {
   *       customizations.additionalJoins.forEach(join => {
   *         query = query.leftJoin(join.table, join.on);
   *       });
   *     }
   *     
   *     if (customizations.additionalWheres) {
   *       customizations.additionalWheres.forEach(where => {
   *         query = query.where(where.column, where.operator, where.value);
   *     }
   *     
   *     if (customizations.orderBy) {
   *       query = query.orderBy(customizations.orderBy.column, customizations.orderBy.direction);
   *     }
   *     
   *     if (customizations.limit) {
   *       query = query.limit(customizations.limit);
   *     }
   *     
   *     if (customizations.offset) {
   *       query = query.offset(customizations.offset);
   *     }
   *     
   *     // Executa a query customizada
   *     return await query.all();
   *   }
   * }
   */
  clone(): this { const newQuery = new (this.constructor as any)(this.tableName); Object.assign(newQuery, { ...this, selectColumns: [...this.selectColumns], whereClauses: [...this.whereClauses], orWhereClauses: [...this.orWhereClauses], joins: [...this.joins], orderClauses: [...this.orderClauses], groupByColumns: [...this.groupByColumns], havingClauses: [...this.havingClauses], aggregates: [...this.aggregates], }); return newQuery; }

  /**
   * Adiciona uma cláusula ORDER BY para ordenar os resultados.
   * Múltiplas chamadas criam ordenação por múltiplas colunas.
   * 
   * @param column - Nome da coluna ou chave do tipo T para ordenar
   * @param direction - Direção da ordenação ('ASC' ou 'DESC', padrão: 'ASC')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Ordenação simples
   * const users = await new QueryBuilder<User>('users')
   *   .orderBy('name', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas ordenações
   * const users = await new QueryBuilder<User>('users')
   *   .orderBy('role', 'ASC')
   *   .orderBy('created_at', 'DESC')
   *   .orderBy('name', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de ordenação inteligente
   * class SmartOrderingSystem {
   *   static async getUsersWithSmartOrdering(
   *     userPreferences: UserPreferences,
   *     context: OrderingContext
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Ordenação baseada no contexto do usuário
   *     if (context.isSearchResult) {
   *       // Para resultados de busca, prioriza relevância
   *       query = query.orderBy('relevance_score', 'DESC');
   *     }
   *     
   *     // Ordenação baseada nas preferências do usuário
   *     if (userPreferences.sortBy) {
   *       switch (userPreferences.sortBy) {
   *         case 'name':
   *           query = query.orderBy('name', userPreferences.sortDirection || 'ASC');
   *           break;
   *         case 'recent':
   *           query = query.orderBy('last_activity', 'DESC');
   *           break;
   *         case 'popular':
   *           query = query.orderBy('popularity_score', 'DESC');
   *           break;
   *         case 'rating':
   *           query = query.orderBy('average_rating', 'DESC');
   *           break;
   *         case 'experience':
   *           query = query.orderBy('experience_years', 'DESC');
   *           break;
   *         case 'location':
   *           query = query.orderBy('city', 'ASC')
   *                        .orderBy('state', 'ASC');
   *           break;
   *       }
   *     }
   *     
   *     // Ordenação secundária para desempate
   *     if (userPreferences.secondarySort) {
   *       query = query.orderBy(userPreferences.secondarySort.field, userPreferences.secondarySort.direction || 'ASC');
   *     }
   *     
   *     // Ordenação final para consistência
   *     query = query.orderBy('id', 'ASC');
   *     
   *     return await query
   *       .limit(userPreferences.maxResults || 50)
   *       .all();
   *   }
   * }
   */
  orderBy(column: keyof T | string, direction: 'ASC' | 'DESC' = 'ASC'): this { this.orderClauses.push({ column: String(column), direction }); return this; }
  
  /**
   * Adiciona múltiplas cláusulas ORDER BY de uma vez.
   * Útil para aplicar ordenação complexa com uma única chamada.
   * 
   * @param orders - Array de objetos com coluna e direção de ordenação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Múltiplas ordenações simples
   * const users = await new QueryBuilder<User>('users')
   *   .orderByMany([
   *     { column: 'role', direction: 'ASC' },
   *     { column: 'name', direction: 'ASC' }
   *   ])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Ordenação com direções padrão
   * const users = await new QueryBuilder<User>('users')
   *   .orderByMany([
   *     { column: 'department' }, // Usa ASC por padrão
   *     { column: 'created_at', direction: 'DESC' },
   *     { column: 'name' }
   *   ])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de ordenação baseado em regras de negócio
   * class BusinessRuleOrderingSystem {
   *   static async getUsersWithBusinessOrdering(
   *     businessRules: BusinessRules,
   *     userContext: UserContext
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Define regras de ordenação baseadas no contexto de negócio
   *     const orderingRules = this.buildOrderingRules(businessRules, userContext);
   *     
   *     // Aplica ordenação baseada nas regras
   *     if (orderingRules.length > 0) {
   *       query = query.orderByMany(orderingRules);
   *     }
   *     
   *     // Ordenação de fallback para consistência
   *     query = query.orderBy('id', 'ASC');
   *     
   *     return await query
   *       .limit(businessRules.maxResults || 100)
   *       .all();
   *   }
   *   
   *   private static buildOrderingRules(
   *     businessRules: BusinessRules,
   *     userContext: UserContext
   *   ): { column: string; direction?: 'ASC' | 'DESC' }[] {
   *     const rules: { column: string; direction?: 'ASC' | 'DESC' }[] = [];
   *     
   *     // Regra 1: Prioridade baseada no tipo de usuário
   *     if (businessRules.prioritizeUserTypes) {
   *       rules.push({ column: 'user_type_priority', direction: 'ASC' });
   *     }
   *     
   *     // Regra 2: Ordenação por departamento (se aplicável)
   *     if (businessRules.sortByDepartment) {
   *       rules.push({ column: 'department', direction: 'ASC' });
   *     }
   *     
   *     // Regra 3: Ordenação por senioridade
   *     if (businessRules.sortBySeniority) {
   *       rules.push({ column: 'seniority_level', direction: 'DESC' });
   *     }
   *     
   *     // Regra 4: Ordenação por performance
   *     if (businessRules.sortByPerformance) {
   *       rules.push({ column: 'performance_score', direction: 'DESC' });
   *     }
   *     
   *     // Regra 5: Ordenação por disponibilidade
   *     if (businessRules.sortByAvailability) {
   *       rules.push({ column: 'availability_status', direction: 'ASC' });
   *     }
   *     
   *     // Regra 6: Ordenação por localização (se aplicável)
   *     if (businessRules.sortByLocation && userContext.location) {
   *       rules.push({ column: 'distance_from_user', direction: 'ASC' });
   *     }
   *     
   *     // Regra 7: Ordenação por idioma (se aplicável)
   *     if (businessRules.sortByLanguage && userContext.preferredLanguage) {
   *       rules.push({ column: 'language_match_score', direction: 'DESC' });
   *     }
   *     
   *     return rules;
   *   }
   * }
   */
  orderByMany(orders: { column: string; direction?: 'ASC' | 'DESC' }[]): this { orders.forEach(o => this.orderBy(o.column, o.direction || 'ASC')); return this; }
  
  /**
   * Define o número máximo de registros a serem retornados.
   * Útil para paginação e controle de volume de dados.
   * 
   * @param count - Número máximo de registros a retornar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Limite simples
   * const users = await new QueryBuilder<User>('users')
   *   .limit(10)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Limite com ordenação
   * const topUsers = await new QueryBuilder<User>('users')
   *   .orderBy('score', 'DESC')
   *   .limit(5)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de paginação inteligente
   * class IntelligentPaginationSystem {
   *   static async getPaginatedResults(
   *     page: number,
   *     pageSize: number,
   *     userContext: UserContext,
   *     performanceMetrics: PerformanceMetrics
   *   ): Promise<PaginatedResult<User>> {
   *     // Ajusta o tamanho da página baseado no contexto do usuário
   *     let adjustedPageSize = this.calculateOptimalPageSize(
   *       pageSize,
   *       userContext.deviceType,
   *       userContext.connectionSpeed,
   *       performanceMetrics
   *     );
   *     
   *     // Calcula offset baseado na página
   *     const offset = (page - 1) * adjustedPageSize;
   *     
   *     // Aplica limite e offset
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true)
   *       .limit(adjustedPageSize)
   *       .offset(offset);
   *     
   *     // Ordenação baseada no contexto
   *     if (userContext.preferences.sortBy) {
   *       query = query.orderBy(userContext.preferences.sortBy, userContext.preferences.sortDirection || 'ASC');
   *     }
   *     
   *     // Executa a query
   *     const users = await query.all();
   *     
   *     // Calcula metadados de paginação
   *     const totalCount = await this.getTotalCount(query.clone());
   *     const totalPages = Math.ceil(totalCount / adjustedPageSize);
   *     
   *     return {
   *       data: users,
   *       pagination: {
   *         currentPage: page,
   *         pageSize: adjustedPageSize,
   *         totalPages,
   *         totalCount,
   *         hasNextPage: page < totalPages,
   *         hasPreviousPage: page > 1
   *       },
   *       performance: {
   *         queryTime: performanceMetrics.queryTime,
   *         pageSize: adjustedPageSize,
   *         optimizationApplied: true
   *       }
   *     };
   *   }
   *   
   *   private static calculateOptimalPageSize(
   *     requestedSize: number,
   *     deviceType: string,
   *     connectionSpeed: string,
   *     performanceMetrics: PerformanceMetrics
   *   ): number {
   *     let optimalSize = requestedSize;
   *     
   *     // Ajusta baseado no tipo de dispositivo
   *     if (deviceType === 'mobile') {
   *       optimalSize = Math.min(optimalSize, 20);
   *     } else if (deviceType === 'tablet') {
   *       optimalSize = Math.min(optimalSize, 30);
   *     }
   *     
   *     // Ajusta baseado na velocidade da conexão
   *     if (connectionSpeed === 'slow') {
   *       optimalSize = Math.min(optimalSize, 15);
   *     } else if (connectionSpeed === 'fast') {
   *       optimalSize = Math.min(optimalSize, 50);
   *     }
   *     
   *     // Ajusta baseado no histórico de performance
   *     if (performanceMetrics.averageQueryTime > 1000) {
   *       optimalSize = Math.max(optimalSize / 2, 10);
   *     }
   *     
   *     return Math.max(optimalSize, 5); // Mínimo de 5 registros
   *   }
   * }
   */
  limit(count: number): this { this.limitValue = count; return this; }
  
  /**
   * Define o número de registros a serem pulados antes de retornar resultados.
   * Útil para paginação e navegação em grandes conjuntos de dados.
   * 
   * @param count - Número de registros a pular
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Offset simples
   * const users = await new QueryBuilder<User>('users')
   *   .offset(10)
   *   .limit(10)
   *   .all(); // Retorna usuários 11-20
   * 
   * @example
   * // Exemplo intermediário - Paginação com offset
   * const page = 3;
   * const pageSize = 25;
   * const users = await new QueryBuilder<User>('users')
   *   .offset((page - 1) * pageSize)
   *   .limit(pageSize)
   *   .orderBy('name', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de paginação com cache inteligente
   * class CachedPaginationSystem {
   *   private static pageCache = new Map<string, CachedPage>();
   *   
   *   static async getCachedPage(
   *     cacheKey: string,
   *     page: number,
   *     pageSize: number,
   *     queryBuilder: QueryBuilder<User>,
   *     cacheOptions: CacheOptions
   *   ): Promise<CachedPageResult> {
   *     const cacheKeyWithPage = `${cacheKey}_page_${page}_size_${pageSize}`;
   *     
   *     // Verifica se a página está em cache
   *     if (this.pageCache.has(cacheKeyWithPage)) {
   *       const cached = this.pageCache.get(cacheKeyWithPage)!;
   *       
   *       // Verifica se o cache ainda é válido
   *       if (Date.now() - cached.timestamp < cacheOptions.ttl) {
   *         return {
   *           data: cached.data,
   *           fromCache: true,
   *           cacheAge: Date.now() - cached.timestamp
   *         };
   *       }
   *     }
   *     
   *     // Calcula offset para a página
   *     const offset = (page - 1) * pageSize;
   *     
   *     // Executa a query com paginação
   *     const users = await queryBuilder
   *       .clone()
   *       .offset(offset)
   *       .limit(pageSize)
   *       .all();
   *     
   *     // Armazena no cache
   *     const cachedPage: CachedPage = {
   *       data: users,
   *       timestamp: Date.now(),
   *       page,
   *       pageSize
   *     };
   *     
   *     this.pageCache.set(cacheKeyWithPage, cachedPage);
   *     
   *     // Limpa cache antigo se necessário
   *     this.cleanupOldCache(cacheOptions.maxCacheSize);
   *     
   *     return {
   *       data: users,
   *       fromCache: false,
   *       cacheAge: 0
   *     };
   *   }
   *   
   *   private static cleanupOldCache(maxSize: number): void {
   *     if (this.pageCache.size > maxSize) {
   *       const sortedEntries = Array.from(this.pageCache.entries())
   *         .sort((a, b) => a[1].timestamp - b[1].timestamp);
   *       
   *       // Remove as entradas mais antigas
   *       const toRemove = sortedEntries.slice(0, this.pageCache.size - maxSize);
   *       toRemove.forEach(([key]) => this.pageCache.delete(key));
   *     }
   *   }
   * }
   */
  offset(count: number): this { this.offsetValue = count; return this; }

  /**
   * Adiciona um INNER JOIN à consulta.
   * Retorna apenas registros que têm correspondência em ambas as tabelas.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param on - Condição de junção (ex: 'users.id = posts.user_id')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - INNER JOIN simples
   * const usersWithPosts = await new QueryBuilder<User>('users')
   *   .innerJoin('posts', 'users.id = posts.user_id')
   *   .select(['users.name', 'posts.title'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos INNER JOINs
   * const usersWithDetails = await new QueryBuilder<User>('users')
   *   .innerJoin('profiles', 'users.id = profiles.user_id')
   *   .innerJoin('departments', 'users.department_id = departments.id')
   *   .select(['users.name', 'profiles.bio', 'departments.name as dept_name'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios complexos com múltiplos JOINs
   * class ComplexReportingSystem {
   *   static async generateUserActivityReport(
   *     dateRange: DateRange,
   *     departmentIds: number[],
   *     activityTypes: string[]
   *   ): Promise<UserActivityReport[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'departments.name as department',
   *         'profiles.title as job_title',
   *         'profiles.experience_years',
   *         'COUNT(posts.id) as total_posts',
   *         'COUNT(comments.id) as total_comments',
   *         'COUNT(logins.id) as total_logins',
   *         'MAX(logins.created_at) as last_login',
   *         'AVG(activity_scores.score) as avg_activity_score'
   *       ])
   *       .innerJoin('profiles', 'users.id = profiles.user_id')
   *       .innerJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('posts', 'users.id = posts.user_id AND posts.created_at BETWEEN ? AND ?')
   *       .leftJoin('comments', 'users.id = comments.user_id AND comments.created_at BETWEEN ? AND ?')
   *       .leftJoin('logins', 'users.id = logins.user_id AND logins.created_at BETWEEN ? AND ?')
   *       .leftJoin('activity_scores', 'users.id = activity_scores.user_id AND activity_scores.period = ?')
   *       .where('users.active', '=', true)
   *       .whereIn('users.department_id', departmentIds)
   *       .whereIn('profiles.activity_type', activityTypes)
   *       .groupBy('users.id')
   *       .having('total_posts', '>', 0)
   *       .orderBy('avg_activity_score', 'DESC');
   *     
   *     // Adiciona bindings para as datas
   *     const bindings = [
   *       dateRange.start, dateRange.end, // posts
   *       dateRange.start, dateRange.end, // comments
   *       dateRange.start, dateRange.end, // logins
   *       dateRange.period // activity_scores
   *     ];
   *     
   *     // Executa a query com bindings customizados
   *     const { sql, bindings: queryBindings } = query.toSql();
   *     const finalBindings = [...queryBindings, ...bindings];
   *     
   *     // Executa a query raw devido aos bindings complexos
   *     const executor = getExecutorForTable('users');
   *     const result = await executor.executeQuery(sql, finalBindings);
   *     
   *     return result.data.map(row => ({
   *       userId: row.id,
   *       name: row.name,
   *       email: row.email,
   *       department: row.department,
   *       jobTitle: row.job_title,
   *       experienceYears: row.experience_years,
   *       totalPosts: row.total_posts,
   *       totalComments: row.total_comments,
   *       totalLogins: row.total_logins,
   *       lastLogin: row.last_login,
   *       averageActivityScore: row.avg_activity_score
   *     }));
   *   }
   * }
   */
  innerJoin(targetTable: string, on: string): this { this.joins.push({ type: 'INNER', table: targetTable, on }); return this; }
  
  /**
   * Adiciona um LEFT JOIN à consulta.
   * Retorna todos os registros da tabela principal, mesmo sem correspondência na tabela unida.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param on - Condição de junção (ex: 'users.id = posts.user_id')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - LEFT JOIN simples
   * const allUsersWithPosts = await new QueryBuilder<User>('users')
   *   .leftJoin('posts', 'users.id = posts.user_id')
   *   .select(['users.name', 'posts.title'])
   *   .all(); // Inclui usuários sem posts
   * 
   * @example
   * // Exemplo intermediário - Múltiplos LEFT JOINs
   * const allUsersWithDetails = await new QueryBuilder<User>('users')
   *   .leftJoin('profiles', 'users.id = profiles.user_id')
   *   .leftJoin('preferences', 'users.id = preferences.user_id')
   *   .select(['users.name', 'profiles.bio', 'preferences.theme'])
   *   .all(); // Inclui usuários sem perfil ou preferências
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de dados com JOINs condicionais
   * class DataAnalysisSystem {
   *   static async analyzeUserEngagement(
   *     analysisPeriod: DateRange,
   *     includeInactive: boolean = false
   *   ): Promise<UserEngagementAnalysis[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.created_at',
   *         'profiles.bio',
   *         'profiles.interests',
   *         'COUNT(DISTINCT posts.id) as posts_count',
   *         'COUNT(DISTINCT comments.id) as comments_count',
   *         'COUNT(DISTINCT likes.id) as likes_given',
   *         'COUNT(DISTINCT received_likes.id) as likes_received',
   *         'MAX(posts.created_at) as last_post_date',
   *         'MAX(comments.created_at) as last_comment_date',
   *         'MAX(activity_log.created_at) as last_activity',
   *         'AVG(engagement_scores.score) as avg_engagement',
   *         'CASE WHEN profiles.verified = 1 THEN "Verified" ELSE "Unverified" END as verification_status'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('posts', 'users.id = posts.user_id AND posts.status = "published" AND posts.created_at BETWEEN ? AND ?')
   *       .leftJoin('comments', 'users.id = comments.user_id AND comments.approved = 1 AND comments.created_at BETWEEN ? AND ?')
   *       .leftJoin('likes', 'users.id = likes.user_id AND likes.created_at BETWEEN ? AND ?')
   *       .leftJoin('posts as posts_for_likes', 'likes.post_id = posts_for_likes.id')
   *       .leftJoin('likes as received_likes', 'posts_for_likes.user_id = users.id AND received_likes.created_at BETWEEN ? AND ?')
   *       .leftJoin('activity_log', 'users.id = activity_log.user_id AND activity_log.created_at BETWEEN ? AND ?')
   *       .leftJoin('engagement_scores', 'users.id = engagement_scores.user_id AND engagement_scores.period = ?')
   *       .where('users.active', '=', true);
   *     
   *     // Filtros condicionais baseados no parâmetro includeInactive
   *     if (!includeInactive) {
   *       query = query.where('users.last_activity', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
   *     }
   *     
   *     query = query
   *       .groupBy('users.id')
   *       .having('posts_count + comments_count + likes_given', '>', 0) // Apenas usuários com alguma atividade
   *       .orderBy('avg_engagement', 'DESC')
   *       .orderBy('posts_count', 'DESC');
   *     
   *     // Executa com bindings para o período de análise
   *     const bindings = [
   *       analysisPeriod.start, analysisPeriod.end, // posts
   *       analysisPeriod.start, analysisPeriod.end, // comments
   *       analysisPeriod.start, analysisPeriod.end, // likes given
   *       analysisPeriod.start, analysisPeriod.end, // likes received
   *       analysisPeriod.start, analysisPeriod.end, // activity log
   *       analysisPeriod.period // engagement scores
   *     ];
   *     
   *     const { sql, bindings: queryBindings } = query.toSql();
   *     const finalBindings = [...queryBindings, ...bindings];
   *     
   *     const executor = getExecutorForTable('users');
   *     const result = await executor.executeQuery(sql, finalBindings);
   *     
   *     return result.data.map(row => ({
   *       userId: row.id,
   *       name: row.name,
   *       createdAt: row.created_at,
   *       bio: row.bio,
   *       interests: row.interests,
   *       postsCount: row.posts_count,
   *       commentsCount: row.comments_count,
   *       likesGiven: row.likes_given,
   *       likesReceived: row.likes_received,
   *       lastPostDate: row.last_post_date,
   *       lastCommentDate: row.last_comment_date,
   *       lastActivity: row.last_activity,
   *       averageEngagement: row.avg_engagement,
   *       verificationStatus: row.verification_status,
   *       totalEngagement: row.posts_count + row.comments_count + row.likes_given
   *     }));
   *   }
   * }
   */
  leftJoin(targetTable: string, on: string): this { this.joins.push({ type: 'LEFT', table: targetTable, on }); return this; }
  
  /**
   * Adiciona um RIGHT JOIN à consulta.
   * Retorna todos os registros da tabela unida, mesmo sem correspondência na tabela principal.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param on - Condição de junção (ex: 'users.id = posts.user_id')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - RIGHT JOIN simples
   * const allPostsWithUsers = await new QueryBuilder<Post>('posts')
   *   .rightJoin('users', 'posts.user_id = users.id')
   *   .select(['posts.title', 'users.name'])
   *   .all(); // Inclui posts mesmo se usuário não existir
   * 
   * @example
   * // Exemplo intermediário - RIGHT JOIN com filtros
   * const allCommentsWithUsers = await new QueryBuilder<Comment>('comments')
   *   .rightJoin('users', 'comments.user_id = users.id')
   *   .rightJoin('posts', 'comments.post_id = posts.id')
   *   .select(['comments.content', 'users.name', 'posts.title'])
   *   .where('comments.approved', '=', true)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de auditoria com RIGHT JOINs
   * class AuditSystem {
   *   static async auditAllSystemActions(
   *     auditPeriod: DateRange,
   *     includeDeletedUsers: boolean = false
   *   ): Promise<SystemAuditReport[]> {
   *     let query = new QueryBuilder<AuditLog>('audit_logs')
   *       .select([
   *         'audit_logs.id',
   *         'audit_logs.action',
   *         'audit_logs.timestamp',
   *         'audit_logs.details',
   *         'users.name as user_name',
   *         'users.email as user_email',
   *         'users.role as user_role',
   *         'departments.name as department_name',
   *         'CASE WHEN users.deleted_at IS NOT NULL THEN "Deleted User" ELSE users.status END as user_status',
   *         'ip_addresses.country as ip_country',
   *         'ip_addresses.city as ip_city',
   *         'sessions.device_type',
   *         'sessions.user_agent'
   *       ])
   *       .rightJoin('users', 'audit_logs.user_id = users.id')
   *       .rightJoin('departments', 'users.department_id = departments.id')
   *       .rightJoin('ip_addresses', 'audit_logs.ip_address = ip_addresses.ip')
   *       .rightJoin('sessions', 'audit_logs.session_id = sessions.id')
   *       .whereBetween('audit_logs.timestamp', [auditPeriod.start, auditPeriod.end]);
   *     
   *     // Filtros condicionais
   *     if (!includeDeletedUsers) {
   *       query = query.where('users.deleted_at', 'IS', null);
   *     }
   *     
   *     query = query
   *       .orderBy('audit_logs.timestamp', 'DESC')
   *       .orderBy('audit_logs.id', 'DESC');
   *     
   *     const result = await query.all();
   *     
   *     return result.map(row => ({
   *       auditId: row.id,
   *       action: row.action,
   *       timestamp: row.timestamp,
   *       details: row.details,
   *       userName: row.user_name,
   *       userEmail: row.user_email,
   *       userRole: row.user_role,
   *       departmentName: row.department_name,
   *       userStatus: row.user_status,
   *       ipCountry: row.ip_country,
   *       ipCity: row.ip_city,
   *       deviceType: row.device_type,
   *       userAgent: row.user_agent
   *     }));
   *   }
   * }
   */
  rightJoin(targetTable: string, on: string): this { this.joins.push({ type: 'RIGHT', table: targetTable, on }); return this; }
  
  /**
   * Adiciona um INNER JOIN com condição de igualdade entre duas colunas.
   * Atalho para JOINs simples baseados em igualdade de colunas.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param left - Nome da coluna da tabela principal
   * @param right - Nome da coluna da tabela unida
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - JOIN simples por igualdade
   * const usersWithProfiles = await new QueryBuilder<User>('users')
   *   .innerJoinOn('profiles', 'users.id', 'profiles.user_id')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos JOINs por igualdade
   * const usersWithDetails = await new QueryBuilder<User>('users')
   *   .innerJoinOn('profiles', 'users.id', 'profiles.user_id')
   *   .innerJoinOn('departments', 'users.department_id', 'departments.id')
   *   .innerJoinOn('roles', 'users.role_id', 'roles.id')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relacionamentos hierárquicos
   * class HierarchicalRelationshipSystem {
   *   static async getOrganizationalHierarchy(
   *     rootDepartmentId: number,
   *     includeInactive: boolean = false
   *   ): Promise<OrganizationalHierarchy[]> {
   *     let query = new QueryBuilder<Department>('departments')
   *       .select([
   *         'departments.id',
   *         'departments.name',
   *         'departments.level',
   *         'parent.name as parent_department',
   *         'managers.name as manager_name',
   *         'managers.email as manager_email',
   *         'COUNT(employees.id) as employee_count',
   *         'AVG(employees.salary) as avg_salary',
   *         'SUM(CASE WHEN employees.active = 1 THEN 1 ELSE 0 END) as active_employees'
   *       ])
   *       .leftJoinOn('departments as parent', 'departments.parent_id', 'parent.id')
   *       .leftJoinOn('users as managers', 'departments.manager_id', 'managers.id')
   *       .leftJoinOn('users as employees', 'departments.id', 'employees.department_id')
   *       .where('departments.active', '=', true)
   *       .where('departments.id', '=', rootDepartmentId)
   *       .groupBy('departments.id')
   *       .orderBy('departments.level', 'ASC')
   *       .orderBy('departments.name', 'ASC');
   *     
   *     if (!includeInactive) {
   *       query = query.where('employees.active', '=', true);
   *     }
   *     
   *     const result = await query.all();
   *     
   *     return result.map(row => ({
   *       departmentId: row.id,
   *       departmentName: row.name,
   *       level: row.level,
   *       parentDepartment: row.parent_department,
   *       managerName: row.manager_name,
   *       managerEmail: row.manager_email,
   *       employeeCount: row.employee_count,
   *       averageSalary: row.avg_salary,
   *       activeEmployees: row.active_employees
   *     }));
   *   }
   * }
   */
  innerJoinOn(targetTable: string, left: string, right: string): this { return this.innerJoin(targetTable, `${left} = ${right}`); }
  
  /**
   * Adiciona um LEFT JOIN com condição de igualdade entre duas colunas.
   * Atalho para LEFT JOINs simples baseados em igualdade de colunas.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param left - Nome da coluna da tabela principal
   * @param right - Nome da coluna da tabela unida
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - LEFT JOIN simples por igualdade
   * const allUsersWithProfiles = await new QueryBuilder<User>('users')
   *   .leftJoinOn('profiles', 'users.id', 'profiles.user_id')
   *   .all(); // Inclui usuários sem perfil
   * 
   * @example
   * // Exemplo intermediário - Múltiplos LEFT JOINs por igualdade
   * const allUsersWithDetails = await new QueryBuilder<User>('users')
   *   .leftJoinOn('profiles', 'users.id', 'profiles.user_id')
   *   .leftJoinOn('preferences', 'users.id', 'preferences.user_id')
   *   .leftJoinOn('settings', 'users.id', 'settings.user_id')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de dados com JOINs opcionais
   * class OptionalDataAnalysisSystem {
   *   static async analyzeUserDataCompleteness(
   *     dataQualityThresholds: DataQualityThresholds
   *   ): Promise<UserDataCompletenessReport[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'users.created_at',
   *         'profiles.bio',
   *         'profiles.phone',
   *         'profiles.address',
   *         'profiles.birth_date',
   *         'preferences.notification_email',
   *         'preferences.notification_sms',
   *         'preferences.theme',
   *         'settings.language',
   *         'settings.timezone',
   *         'settings.privacy_level',
   *         'verifications.email_verified',
   *         'verifications.phone_verified',
   *         'verifications.identity_verified'
   *       ])
   *       .leftJoinOn('profiles', 'users.id', 'profiles.user_id')
   *       .leftJoinOn('preferences', 'users.id', 'preferences.user_id')
   *       .leftJoinOn('settings', 'users.id', 'settings.user_id')
   *       .leftJoinOn('verifications', 'users.id', 'verifications.user_id')
   *       .where('users.active', '=', true)
   *       .orderBy('users.created_at', 'DESC');
   *     
   *     const result = await query.all();
   *     
   *     return result.map(row => {
   *       // Calcula score de completude dos dados
   *       const completenessScore = this.calculateCompletenessScore(row, dataQualityThresholds);
   *       
   *       return {
   *         userId: row.id,
   *         name: row.name,
   *         email: row.email,
   *         createdAt: row.created_at,
   *         profileCompleteness: this.calculateProfileCompleteness(row),
   *         preferencesCompleteness: this.calculatePreferencesCompleteness(row),
   *         settingsCompleteness: this.calculateSettingsCompleteness(row),
   *         verificationCompleteness: this.calculateVerificationCompleteness(row),
   *         overallCompleteness: completenessScore,
   *         dataQualityLevel: this.getDataQualityLevel(completenessScore),
   *         missingFields: this.getMissingFields(row),
   *         recommendations: this.getDataCompletenessRecommendations(row, completenessScore)
   *       };
   *     });
   *   }
   *   
   *   private static calculateCompletenessScore(user: any, thresholds: DataQualityThresholds): number {
   *     let score = 0;
   *     let totalFields = 0;
   *     
   *     // Campos obrigatórios
   *     if (user.name) { score += thresholds.requiredFieldWeight; }
   *     if (user.email) { score += thresholds.requiredFieldWeight; }
   *     totalFields += 2;
   *     
   *     // Campos de perfil
   *     if (user.bio) { score += thresholds.profileFieldWeight; }
   *     if (user.phone) { score += thresholds.profileFieldWeight; }
   *     if (user.address) { score += thresholds.profileFieldWeight; }
   *     if (user.birth_date) { score += thresholds.profileFieldWeight; }
   *     totalFields += 4;
   *     
   *     // Campos de preferências
   *     if (user.notification_email !== null) { score += thresholds.preferenceFieldWeight; }
   *     if (user.notification_sms !== null) { score += thresholds.preferenceFieldWeight; }
   *     if (user.theme) { score += thresholds.preferenceFieldWeight; }
   *     totalFields += 3;
   *     
   *     // Campos de configurações
   *     if (user.language) { score += thresholds.settingFieldWeight; }
   *     if (user.timezone) { score += thresholds.settingFieldWeight; }
   *     if (user.privacy_level !== null) { score += thresholds.settingFieldWeight; }
   *     totalFields += 3;
   *     
   *     // Campos de verificação
   *     if (user.email_verified) { score += thresholds.verificationFieldWeight; }
   *     if (user.phone_verified) { score += thresholds.verificationFieldWeight; }
   *     if (user.identity_verified) { score += thresholds.verificationFieldWeight; }
   *     totalFields += 3;
   *     
   *     return Math.round((score / totalFields) * 100);
   *   }
   * }
   */
  leftJoinOn(targetTable: string, left: string, right: string): this { return this.leftJoin(targetTable, `${left} = ${right}`); }
  
  /**
   * Adiciona um RIGHT JOIN com condição de igualdade entre duas colunas.
   * Atalho para RIGHT JOINs simples baseados em igualdade de colunas.
   * 
   * @param targetTable - Nome da tabela a ser unida
   * @param left - Nome da coluna da tabela principal
   * @param right - Nome da coluna da tabela unida
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - RIGHT JOIN simples por igualdade
   * const allProfilesWithUsers = await new QueryBuilder<Profile>('profiles')
   *   .rightJoinOn('users', 'profiles.user_id', 'users.id')
   *   .all(); // Inclui perfis mesmo se usuário não existir
   * 
   * @example
   * // Exemplo intermediário - RIGHT JOIN com filtros
   * const allPreferencesWithUsers = await new QueryBuilder<Preference>('preferences')
   *   .rightJoinOn('users', 'preferences.user_id', 'users.id')
   *   .where('preferences.active', '=', true)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de auditoria de dados órfãos
   * class OrphanedDataAuditSystem {
   *   static async auditOrphanedRecords(
   *     auditConfig: OrphanedDataAuditConfig
   *   ): Promise<OrphanedDataReport[]> {
   *     const reports: OrphanedDataReport[] = [];
   *     
   *     // Auditoria de perfis órfãos
   *     if (auditConfig.includeProfiles) {
   *       const orphanedProfiles = await new QueryBuilder<Profile>('profiles')
   *         .select([
   *           'profiles.id',
   *           'profiles.user_id',
   *           'profiles.bio',
   *           'profiles.created_at',
   *           'profiles.updated_at',
   *           'CASE WHEN users.id IS NULL THEN "Orphaned" ELSE "Valid" END as status'
   *         ])
   *         .rightJoinOn('users', 'profiles.user_id', 'users.id')
   *         .where('users.id', 'IS', null)
   *         .orderBy('profiles.created_at', 'DESC')
   *         .all();
   *       
   *       reports.push({
   *         tableName: 'profiles',
   *         orphanedCount: orphanedProfiles.length,
   *         records: orphanedProfiles,
   *         severity: 'medium',
   *         recommendation: 'Consider removing orphaned profiles or linking to valid users'
   *       });
   *     }
   *     
   *     // Auditoria de preferências órfãs
   *     if (auditConfig.includePreferences) {
   *       const orphanedPreferences = await new QueryBuilder<Preference>('preferences')
   *         .select([
   *           'preferences.id',
   *           'preferences.user_id',
   *           'preferences.key',
   *           'preferences.value',
   *           'preferences.created_at',
   *           'CASE WHEN users.id IS NULL THEN "Orphaned" ELSE "Valid" END as status'
   *         ])
   *         .rightJoinOn('users', 'preferences.user_id', 'users.id')
   *         .where('users.id', 'IS', null)
   *         .orderBy('preferences.created_at', 'DESC')
   *         .all();
   *       
   *       reports.push({
   *         tableName: 'preferences',
   *         orphanedCount: orphanedPreferences.length,
   *         records: orphanedPreferences,
   *         severity: 'low',
   *         recommendation: 'Clean up orphaned preferences to free storage space'
   *       });
   *     }
   *     
   *     // Auditoria de arquivos órfãos
   *     if (auditConfig.includeFiles) {
   *       const orphanedFiles = await new QueryBuilder<File>('files')
   *         .select([
   *           'files.id',
   *           'files.user_id',
   *           'files.filename',
   *           'files.size',
   *           'files.created_at',
   *           'files.path',
   *           'CASE WHEN users.id IS NULL THEN "Orphaned" ELSE "Valid" END as status'
   *         ])
   *         .rightJoinOn('users', 'files.user_id', 'users.id')
   *         .where('users.id', 'IS', null)
   *         .orderBy('files.size', 'DESC')
   *         .all();
   *       
   *       const totalOrphanedSize = orphanedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
   *       
   *       reports.push({
   *         tableName: 'files',
   *         orphanedCount: orphanedFiles.length,
   *         records: orphanedFiles,
   *         severity: 'high',
   *         recommendation: `Remove orphaned files to free ${(totalOrphanedSize / 1024 / 1024).toFixed(2)} MB of storage`,
   *         additionalData: { totalOrphanedSize }
   *       });
   *     }
   *     
   *     return reports;
   *   }
   * }
   */
  rightJoinOn(targetTable: string, left: string, right: string): this { return this.rightJoin(targetTable, `${left} = ${right}`); }

  /**
   * Gera a string SQL e os bindings para a query construída.
   * Útil para debug, logging ou execução manual da query.
   * 
   * @returns Objeto contendo a string SQL e array de bindings
   * 
   * @example
   * // Exemplo básico - Gerar SQL simples
   * const { sql, bindings } = new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .toSql();
   * console.log('SQL:', sql);
   * console.log('Bindings:', bindings);
   * 
   * @example
   * // Exemplo intermediário - SQL com JOINs e agregações
   * const { sql, bindings } = new QueryBuilder<User>('users')
   *   .select(['users.name', 'departments.name as dept_name'])
   *   .leftJoin('departments', 'users.department_id = departments.id')
   *   .where('users.active', '=', true)
   *   .count('users.id', 'user_count')
   *   .groupBy('users.department_id')
   *   .toSql();
   * 
   * @example
   * // Exemplo avançado - Sistema de debug e profiling de queries
   * class QueryProfilerSystem {
   *   static async profileQuery<T>(
   *     query: QueryBuilder<T>,
   *     context: QueryContext
   *   ): Promise<QueryProfile> {
   *     const startTime = performance.now();
   *     const { sql, bindings } = query.toSql();
   *     
   *     // Analisa complexidade da query
   *     const complexity = this.analyzeQueryComplexity(sql);
   *     
   *     // Executa a query
   *     const results = await query.all();
   *     const executionTime = performance.now() - startTime;
   *     
   *     // Gera perfil da query
   *     const profile: QueryProfile = {
   *       queryId: `query_${Date.now()}`,
   *       context,
   *       sql,
   *       bindings,
   *       complexity,
   *       executionTime,
   *       resultCount: results.length,
   *       timestamp: new Date(),
   *       recommendations: this.generateOptimizationRecommendations(complexity, executionTime)
   *     };
   *     
   *     // Loga perfil para análise
   *     this.logQueryProfile(profile);
   *     
   *     // Armazena para histórico
   *     await this.storeQueryProfile(profile);
   *     
   *     return profile;
   *   }
   *   
   *   private static analyzeQueryComplexity(sql: string): QueryComplexity {
   *     const hasJoins = /JOIN/i.test(sql);
   *     const hasSubqueries = /\(.*SELECT/i.test(sql);
   *     const hasAggregations = /(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql);
   *     const hasGroupBy = /GROUP BY/i.test(sql);
   *     const hasOrderBy = /ORDER BY/i.test(sql);
   *     const hasUnions = /UNION/i.test(sql);
   *     
   *     let complexityScore = 1;
   *     if (hasJoins) complexityScore += 2;
   *     if (hasSubqueries) complexityScore += 3;
   *     if (hasAggregations) complexityScore += 1;
   *     if (hasGroupBy) complexityScore += 2;
   *     if (hasOrderBy) complexityScore += 1;
   *     if (hasUnions) complexityScore += 2;
   *     
   *     return {
   *       score: complexityScore,
   *       level: complexityScore <= 3 ? 'SIMPLE' : 
   *              complexityScore <= 6 ? 'MODERATE' : 'COMPLEX',
   *       hasJoins,
   *       hasSubqueries,
   *       hasAggregations,
   *       hasGroupBy,
   *       hasOrderBy,
   *       hasUnions
   *     };
   *   }
   *   
   *   private static generateOptimizationRecommendations(
   *     complexity: QueryComplexity,
   *     executionTime: number
   *   ): string[] {
   *     const recommendations: string[] = [];
   *     
   *     if (executionTime > 1000) {
   *       recommendations.push('Query execution time exceeds 1 second - consider adding indexes');
   *     }
   *     
   *     if (complexity.hasJoins && complexity.score > 5) {
   *       recommendations.push('Complex JOINs detected - consider denormalization or query splitting');
   *     }
   *     
   *     if (complexity.hasSubqueries) {
   *       recommendations.push('Subqueries detected - consider using JOINs for better performance');
   *     }
   *     
   *     if (complexity.hasAggregations && complexity.hasGroupBy) {
   *       recommendations.push('Aggregations with GROUP BY - ensure proper indexes on grouped columns');
   *     }
   *     
   *     return recommendations;
   *   }
   * }
   */
  public toSql(): { sql: string; bindings: any[] } {
    if (this.aggregates.length > 0) {
      const agg = this.aggregates[0];
      this.selectColumns = [raw(`${agg.func}(${agg.column}) as ${agg.alias || 'aggregate'}`)];
    }
    let baseSelect = `SELECT ${this.isDistinct ? 'DISTINCT' : ''} ${this.selectColumns.map(c => (c && typeof c === 'object' && 'toSQL' in c) ? (c as any).toSQL() : String(c)).join(', ')} FROM ${this.tableName}${this.tableAlias ? ' ' + this.tableAlias : ''}`;
    const params: any[] = [];
    if (this.joins.length > 0) baseSelect += ' ' + this.joins.map(j => `${j.type} JOIN ${j.table} ON ${j.on}`).join(' ');
    const whereClause = this.buildWhereClause(this.whereClauses, params, 'AND');
    if (whereClause) baseSelect += ` WHERE ${whereClause}`;
    if (this.groupByColumns.length > 0) baseSelect += ` GROUP BY ${this.groupByColumns.join(', ')}`;
    if (this.havingClauses.length > 0) {
      const havingClause = this.buildWhereClause(this.havingClauses as any, params, 'AND');
      if (havingClause) baseSelect += ` HAVING ${havingClause}`;
    }
    if (this.unionParts.length === 0) {
      if (this.orderClauses.length > 0) baseSelect += ` ORDER BY ${this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ')}`;
      if (typeof this.limitValue === 'number') { baseSelect += ` LIMIT ?`; params.push(this.limitValue); }
      if (typeof this.offsetValue === 'number') { baseSelect += ` OFFSET ?`; params.push(this.offsetValue); }
    }
    if (this.unionParts.length > 0) {
      let sql = `${baseSelect}`;
      for (const part of this.unionParts) { const { sql: subSql, bindings: subBindings } = part.query.toSql(); sql += ` ${part.type} ${subSql}`; params.push(...subBindings); }
      if (this.orderClauses.length > 0) sql += ` ORDER BY ${this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ')}`;
      if (typeof this.limitValue === 'number') { sql += ` LIMIT ?`; params.push(this.limitValue); }
      if (typeof this.offsetValue === 'number') { sql += ` OFFSET ?`; params.push(this.offsetValue); }
      return { sql, bindings: params };
    }
    return { sql: baseSelect, bindings: params };
  }

  private buildWhereClause(clauses: WhereClause<T>[], params: any[], def: 'AND' | 'OR'): string {
    if (clauses.length === 0) return '';
    return clauses.map((clause, index) => {
      let conditionStr: string;
      switch (clause.type) {
        case 'basic': params.push(clause.value); conditionStr = `${String(clause.column)} ${clause.operator} ?`; break;
        case 'column': conditionStr = `${String(clause.column)} ${clause.operator} ${String(clause.value)}`; break;
        case 'raw': conditionStr = clause.sql!; break;
        case 'in': if (!Array.isArray(clause.value) || clause.value.length === 0) { conditionStr = clause.not ? '1=1' : '1=0'; } else { params.push(...clause.value); const placeholders = clause.value.map(() => '?').join(','); conditionStr = `${String(clause.column)} ${clause.not ? 'NOT IN' : 'IN'} (${placeholders})`; } break;
        case 'null': conditionStr = `${String(clause.column)} IS ${clause.not ? 'NOT ' : ''}NULL`; break;
        case 'between': params.push(...clause.value); conditionStr = `${String(clause.column)} ${clause.not ? 'NOT BETWEEN' : 'BETWEEN'} ? AND ?`; break;
        case 'exists': const { sql, bindings } = clause.query!.toSql(); params.push(...bindings); conditionStr = `${clause.not ? 'NOT ' : ''}EXISTS (${sql})`; break;
        default: throw new Error('Unsupported where clause type');
      }
      const logical = index > 0 ? clause.logical || def : '';
      return `${logical} ${conditionStr}`;
    }).join(' ').trim();
  }

  /**
   * Executa a query e retorna o primeiro registro encontrado.
   * Aplica automaticamente LIMIT 1 para otimização.
   * 
   * @returns O primeiro registro encontrado ou undefined se nenhum for encontrado
   * 
   * @example
   * // Exemplo básico - Obter primeiro usuário
   * const firstUser = await new QueryBuilder<User>('users')
   *   .orderBy('created_at', 'ASC')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Obter primeiro usuário ativo
   * const firstActiveUser = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .where('verified', '=', true)
   *   .orderBy('last_login', 'DESC')
   *   .get();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca de usuário mais relevante
   * class UserRelevanceSystem {
   *   static async findMostRelevantUser(
   *     searchCriteria: SearchCriteria,
   *     userPreferences: UserPreferences
   *   ): Promise<User | undefined> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.*',
   *         'profiles.bio',
   *         'profiles.skills',
   *         'profiles.experience_years',
   *         'departments.name as department_name',
   *         'CASE WHEN users.verified = 1 THEN 10 ELSE 0 END + ' +
   *         'CASE WHEN users.active = 1 THEN 5 ELSE 0 END + ' +
   *         'CASE WHEN profiles.experience_years >= 5 THEN 3 ELSE 0 END + ' +
   *         'CASE WHEN users.last_login > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 2 ELSE 0 END as relevance_score'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('departments', 'users.id = departments.id')
   *       .where('users.active', '=', true);
   *     
   *     // Aplica filtros baseados nos critérios de busca
   *     if (searchCriteria.role) {
   *       query = query.where('users.role', '=', searchCriteria.role);
   *     }
   *     
   *     if (searchCriteria.department) {
   *       query = query.where('users.department_id', '=', searchCriteria.department);
   *     }
   *     
   *     if (searchCriteria.minExperience) {
   *       query = query.where('profiles.experience_years', '>=', searchCriteria.minExperience);
   *     }
   *     
   *     if (searchCriteria.skills) {
   *       searchCriteria.skills.forEach(skill => {
   *         query = query.whereRaw(`JSON_CONTAINS(profiles.skills, '"${skill}"')`);
   *       });
   *     }
   *     
   *     // Aplica filtros baseados nas preferências do usuário
   *     if (userPreferences.requireVerification) {
   *       query = query.where('users.verified', '=', true);
   *     }
   *     
   *     if (userPreferences.locationPreference) {
   *       query = query.where('users.location', '=', userPreferences.locationPreference);
   *     }
   *     
   *     // Ordena por relevância e retorna o primeiro
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .orderBy('users.last_activity', 'DESC')
   *       .get();
   *   }
   * }
   */
  get<U = T>(): U | undefined { this.limit(1); const rows = this.allSync<U>(); return rows[0]; }
  /**
   * Alias para o método .get().
   * Retorna o primeiro registro encontrado pela query.
   * 
   * @returns O primeiro registro encontrado ou undefined se nenhum for encontrado
   * 
   * @example
   * // Exemplo básico - Obter primeiro usuário
   * const firstUser = await new QueryBuilder<User>('users')
   *   .first();
   * 
   * @example
   * // Exemplo intermediário - Obter primeiro usuário com filtros
   * const firstAdmin = await new QueryBuilder<User>('users')
   *   .where('role', '=', 'admin')
   *   .where('active', '=', true)
   *   .first();
   * 
   * @example
   * // Exemplo avançado - Sistema de seleção de usuário para tarefa
   * class TaskAssignmentSystem {
   *   static async findBestUserForTask(
   *     task: Task,
   *     assignmentCriteria: AssignmentCriteria
   *   ): Promise<User | undefined> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.*',
   *         'profiles.skills',
   *         'profiles.experience_years',
   *         'workload.current_tasks as current_task_count',
   *         'performance.avg_completion_time as avg_completion_time',
   *         'performance.success_rate as success_rate',
   *         'availability.next_available as next_available',
   *         'CASE WHEN users.role = "senior" THEN 10 ' +
   *         'WHEN users.role = "intermediate" THEN 7 ' +
   *         'ELSE 5 END + ' +
   *         'CASE WHEN workload.current_tasks < 3 THEN 5 ' +
   *         'WHEN workload.current_tasks < 5 THEN 3 ' +
   *         'ELSE 1 END + ' +
   *         'CASE WHEN performance.success_rate >= 0.9 THEN 5 ' +
   *         'WHEN performance.success_rate >= 0.8 THEN 3 ' +
   *         'ELSE 1 END as assignment_score'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('workload', 'users.id = workload.user_id')
   *       .leftJoin('performance', 'users.id = performance.user_id')
   *       .leftJoin('availability', 'users.id = availability.user_id')
   *       .where('users.active', '=', true)
   *       .where('users.available_for_tasks', '=', true);
   *     
   *     // Filtros baseados nos requisitos da tarefa
   *     if (task.requiredSkills) {
   *       task.requiredSkills.forEach(skill => {
   *         query = query.whereRaw(`JSON_CONTAINS(profiles.skills, '"${skill}"')`);
   *       });
   *     }
   *     
   *     if (task.minExperience) {
   *       query = query.where('profiles.experience_years', '>=', task.minExperience);
   *     }
   *     
   *     if (task.requiredRole) {
   *       query = query.where('users.role', '>=', task.requiredRole);
   *     }
   *     
   *     // Filtros baseados nos critérios de atribuição
   *     query = query
   *       .where('workload.current_tasks', '<=', assignmentCriteria.maxConcurrentTasks)
   *       .where('performance.success_rate', '>=', assignmentCriteria.minSuccessRate)
   *       .where('availability.next_available', '<=', task.deadline);
   *     
   *     // Retorna o usuário mais adequado
   *     return await query
   *       .orderBy('assignment_score', 'DESC')
   *       .orderBy('performance.avg_completion_time', 'ASC')
   *       .first();
   *   }
   * }
   */
  first<U = T>(): U | undefined { return this.get<U>(); }
  
  /**
   * Busca um usuário específico pelo ID.
   * Atalho para .where('id', '=', id).get().
   * 
   * @param id - ID do usuário a ser buscado
   * @returns O usuário encontrado ou undefined se não existir
   * 
   * @example
   * // Exemplo básico - Buscar usuário por ID
   * const user = await new QueryBuilder<User>('users')
   *   .find(123);
   * 
   * @example
   * // Exemplo intermediário - Buscar usuário com relacionamentos
   * const userWithProfile = await new QueryBuilder<User>('users')
   *   .leftJoin('profiles', 'users.id = profiles.user_id')
   *   .select(['users.*', 'profiles.bio', 'profiles.skills'])
   *   .find(123);
   * 
   * @example
   * // Exemplo avançado - Sistema de busca de usuário com cache
   * class CachedUserLookupSystem {
   *   private static userCache = new Map<number, { user: User; timestamp: number }>();
   *   private static cacheTTL = 5 * 60 * 1000; // 5 minutos
   *   
   *   static async findUserWithCache(
   *     userId: number,
   *     includeRelations: boolean = false,
   *     forceRefresh: boolean = false
   *   ): Promise<User | undefined> {
   *     // Verifica cache primeiro
   *     if (!forceRefresh && this.userCache.has(userId)) {
   *       .where('users.active', '=', true);
   *     
   *     // Adiciona relacionamentos se solicitado
   *     if (includeRelations) {
   *       query = query
   *         .leftJoin('profiles', 'users.id = profiles.user_id')
   *         .leftJoin('departments', 'users.department_id = departments.id')
   *         .leftJoin('roles', 'users.role_id = roles.id')
   *         .leftJoin('preferences', 'users.id = preferences.user_id')
   *         .select([
   *           'users.*',
   *           'profiles.bio',
   *           'profiles.skills',
   *           'profiles.experience_years',
   *           'departments.name as department_name',
   *           'roles.name as role_name',
   *           'roles.permissions',
   *           'preferences.theme',
   *           'preferences.language',
   *           'preferences.notifications'
   *         ]);
   *     }
   *     
   *     // Executa a busca
   *     const user = await query.find(userId);
   *     
   *     // Atualiza cache
   *     if (user) {
   *       this.userCache.set(userId, {
   *         user,
   *         timestamp: Date.now()
   *       });
   *       
   *       // Limpa cache antigo se necessário
   *       this.cleanupOldCache();
   *     }
   *     
   *     return user;
   *   }
   *   
   *   private static cleanupOldCache(): void {
   *     const now = Date.now();
   *     for (const [key, value] of this.userCache.entries()) {
   *       if (now - value.timestamp > this.cacheTTL) {
   *         this.userCache.delete(key);
   *       }
   *     }
   *   }
   * }
   */
  find(id: string | number): T | undefined { return this.where('id' as any, '=', id).get(); }

  /**
   * Verifica se existem registros que correspondem aos critérios da query.
   * Otimizado para performance, aplica LIMIT 1 automaticamente.
   * 
   * @returns Promise que resolve para true se existem registros, false caso contrário
   * 
   * @example
   * // Exemplo básico - Verificar existência simples
   * const hasUsers = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .exists();
   * 
   * @example
   * // Exemplo intermediário - Verificar existência com múltiplos critérios
   * const hasActiveAdmins = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .where('role', '=', 'admin')
   *   .where('verified', '=', true)
   *   .exists();
   * 
   * @example
   * // Exemplo avançado - Sistema de validação de dados com verificações múltiplas
   * class DataValidationSystem {
   *   static async validateDataIntegrity(
   *     validationRules: ValidationRule[]
   *   ): Promise<ValidationReport> {
   *     const report: ValidationReport = {
   *       timestamp: new Date(),
   *       totalRules: validationRules.length,
   *       passedRules: 0,
   *       failedRules: 0,
   *       details: []
   *     };
   *     
   *     for (const rule of validationRules) {
   *       try {
   *         let query = new QueryBuilder<any>(rule.tableName);
   *         
   *         // Aplica condições da regra
   *         if (rule.conditions) {
   *           rule.conditions.forEach(condition => {
   *             query = query.where(condition.column, condition.operator, condition.value);
   *           });
   *         }
   *         
   *         // Aplica JOINs se necessário
   *         if (rule.joins) {
   *           rule.joins.forEach(join => {
   *             query = query.leftJoin(join.table, join.on);
   *         }
   *         
   *         // Verifica se a regra é de existência ou não-existência
   *         const exists = await query.exists();
   *         const rulePassed = rule.shouldExist ? exists : !exists;
   *         
   *         if (rulePassed) {
   *           report.passedRules++;
   *           report.details.push({
   *             ruleId: rule.id,
   *             ruleName: rule.name,
   *             status: 'PASSED',
   *             message: rule.successMessage || 'Validation passed'
   *           });
   *         } else {
   *           report.failedRules++;
   *           report.details.push({
   *             ruleId: rule.id,
   *             ruleName: rule.name,
   *             status: 'FAILED',
   *             message: rule.failureMessage || 'Validation failed',
   *             expected: rule.shouldExist ? 'Should exist' : 'Should not exist',
   *             actual: exists ? 'Exists' : 'Does not exist'
   *           });
   *         }
   *       } catch (error) {
   *         report.failedRules++;
   *         report.details.push({
   *           ruleId: rule.id,
   *           ruleName: rule.name,
   *           status: 'ERROR',
   *           message: `Validation error: ${error.message}`,
   *           error: error
   *         });
   *       }
   *     }
   *     
   *     report.successRate = (report.passedRules / report.totalRules) * 100;
   *     report.overallStatus = report.successRate >= 90 ? 'EXCELLENT' :
   *                            report.successRate >= 80 ? 'GOOD' :
   *                            report.successRate >= 70 ? 'FAIR' : 'POOR';
   *     
   *     return report;
   *   }
   * }
   */
  async exists(): Promise<boolean> { const q = this.selectRaw('1').limit(1); const row = await q.all<any>(); return !!(row && row.length); }
  
  /**
   * Extrai uma coluna específica de todos os registros retornados.
   * Útil para obter listas simples de valores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para extrair
   * @returns Promise que resolve para array dos valores da coluna
   * 
   * @example
   * // Exemplo básico - Extrair lista de nomes
   * const userNames = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .pluck('name');
   * 
   * @example
   * // Exemplo intermediário - Extrair múltiplas colunas
   * const userEmails = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .where('verified', '=', true)
   *   .pluck('email');
   * 
   * @example
   * // Exemplo avançado - Sistema de notificações em lote
   * class BatchNotificationSystem {
   *   static async sendNotificationsToUsers(
   *     notificationType: string,
   *     targetCriteria: NotificationTargetCriteria
   *   ): Promise<NotificationBatchResult> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('users.active', '=', true)
   *       .where('users.notifications_enabled', '=', true);
   *     
   *     // Aplica filtros baseados no tipo de notificação
   *     switch (notificationType) {
   *       case 'system_update':
   *         query = query.where('users.role', 'IN', ['admin', 'moderator', 'user']);
   *         break;
   *       case 'security_alert':
   *         query = query.where('users.role', 'IN', ['admin', 'security_officer']);
   *         break;
   *       case 'feature_announcement':
   *         query = query.where('users.beta_features_enabled', '=', true);
   *         break;
   *       case 'maintenance_notice':
   *         query = query.where('users.affected_by_maintenance', '=', true);
   *         break;
   *     }
   *     
   *     // Aplica critérios de destino
   *     if (targetCriteria.departments) {
   *       query = query.whereIn('users.department_id', targetCriteria.departments);
   *     }
   *     
   *     if (targetCriteria.locations) {
   *       query = query.where('users.location', 'IN', targetCriteria.locations);
   *     }
   *     
   *     if (targetCriteria.timeZones) {
   *       query = query.whereIn('users.timezone', targetCriteria.timeZones);
   *     }
   *     
   *     if (targetCriteria.excludeInactive) {
   *       query = query.where('users.last_activity', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
   *     }
   *     
   *     // Extrai IDs dos usuários para notificação
   *     const userIds = await query.pluck('id');
   *     
   *     if (userIds.length === 0) {
   *       return {
   *         success: false,
   *         message: 'No users match the notification criteria',
   *         targetCount: 0,
   *         sentCount: 0,
   *         failedCount: 0
   *       };
   *     }
   *     
   *     // Extrai informações adicionais para personalização
   *     const userEmails = await query.pluck('email');
   *     const userNames = await query.pluck('name');
   *     const userPreferences = await query.pluck('notification_preferences');
   *     
   *     // Envia notificações
   *     const notificationResults = await this.sendNotifications(
   *       userIds,
   *       userEmails,
   *       userNames,
   *       userPreferences,
   *       notificationType
   *     );
   *     
   *     return {
   *       success: true,
   *       message: `Notifications sent to ${notificationResults.sentCount} users`,
   *       targetCount: userIds.length,
   *       sentCount: notificationResults.sentCount,
   *       failedCount: notificationResults.failedCount,
   *       details: notificationResults.details
   *     };
   *   }
   * }
   */
  async pluck(column: keyof T): Promise<any[]> { const results = await this.select([column]).all(); return results.map(r => r[column]); }

  /**
   * Executa a query e retorna todos os registros encontrados.
   * Método principal para consultas de leitura, suporta relacionamentos e simulação.
   * 
   * @returns Promise que resolve para array de registros do tipo U
   * 
   * @example
   * // Exemplo básico - Obter todos os usuários
   * const allUsers = await new QueryBuilder<User>('users')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Obter usuários com filtros e ordenação
   * const activeUsers = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orderBy('created_at', 'DESC')
   *   .limit(100)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios complexos com relacionamentos
   * class AdvancedReportingSystem {
   *   static async generateComprehensiveUserReport(
   *     reportConfig: ComprehensiveReportConfig,
   *     filters: ReportFilters
   *   ): Promise<ComprehensiveUserReport> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.*',
   *         'profiles.bio',
   *         'profiles.skills',
   *         'profiles.experience_years',
   *         'profiles.education_level',
   *         'departments.name as department_name',
   *         'departments.budget as department_budget',
   *         'roles.name as role_name',
   *         'roles.permission_level',
   *         'locations.city',
   *         'locations.country',
   *         'locations.timezone',
   *         'performance.avg_completion_time',
   *         'performance.success_rate',
   *         'performance.quality_score',
   *         'engagement.avg_session_duration',
   *         'engagement.pages_per_session',
   *         'engagement.bounce_rate',
   *         'CASE WHEN users.verified = 1 THEN 10 ELSE 0 END + ' +
   *         'CASE WHEN users.active = 1 THEN 5 ELSE 0 END + ' +
   *         'CASE WHEN profiles.experience_years >= 5 THEN 3 ELSE 0 END + ' +
   *         'CASE WHEN performance.success_rate >= 0.9 THEN 5 ELSE 0 END + ' +
   *         'CASE WHEN engagement.avg_session_duration > 300 THEN 2 ELSE 0 END as overall_score'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('roles', 'users.role_id = roles.id')
   *       .leftJoin('locations', 'users.location_id = locations.id')
   *       .leftJoin('performance', 'users.id = performance.user_id')
   *       .leftJoin('engagement', 'users.id = engagement.user_id');
   *     
   *     // Aplica filtros baseados na configuração do relatório
   *     if (reportConfig.includeOnlyActive) {
   *       query = query.where('users.active', '=', true);
   *     }
   *     
   *     if (reportConfig.minExperienceLevel) {
   *       query = query.where('profiles.experience_years', '>=', reportConfig.minExperienceLevel);
   *     }
   *     
   *     if (reportConfig.requiredSkills) {
   *       reportConfig.requiredSkills.forEach(skill => {
   *         query = query.whereRaw(`JSON_CONTAINS(profiles.skills, '"${skill}"')`);
   *       });
   *     }
   *     
   *     if (reportConfig.departmentFilter) {
   *       query = query.whereIn('users.department_id', reportConfig.departmentFilter);
   *     }
   *     
   *     if (reportConfig.roleFilter) {
   *       query = query.whereIn('users.role_id', reportConfig.roleFilter);
   *     }
   *     
   *     if (reportConfig.locationFilter) {
   *       query = query.whereIn('users.location_id', reportConfig.locationFilter);
   *     }
   *     
   *     if (reportConfig.performanceThreshold) {
   *       query = query.where('performance.success_rate', '>=', reportConfig.performanceThreshold);
   *     }
   *     
   *     // Aplica filtros adicionais
   *     if (filters.dateRange) {
   *       query = query.where('users.created_at', 'BETWEEN', [filters.dateRange.start, filters.dateRange.end]);
   *     }
   *     
   *     if (filters.lastActivityThreshold) {
   *       query = query.where('users.last_activity', '>=', filters.lastActivityThreshold);
   *     }
   *     
   *     if (filters.excludeInactive) {
   *       query = query.where('users.last_login', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
   *     }
   *     
   *     // Aplica agrupamento se necessário
   *     if (reportConfig.groupByDepartment) {
   *       query = query.groupBy('users.department_id');
   *     }
   *     
   *     if (reportConfig.groupByRole) {
   *       query = query.groupBy('users.role_id');
   *     }
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('overall_score', 'DESC');
   *     
   *     if (reportConfig.secondarySort) {
   *       query = query.orderBy(reportConfig.secondarySort.column, reportConfig.secondarySort.direction);
   *     }
   *     
   *     // Aplica paginação se necessário
   *     if (reportConfig.pagination) {
   *       query = query.paginate(reportConfig.pagination.page, reportConfig.pagination.perPage);
   *     }
   *     
   *     // Executa a query
   *     const results = await query.all();
   *     
   *     // Processa os resultados para o relatório
   *     const processedResults = results.map(user => ({
   *       userId: user.id,
   *       userName: user.name,
   *       userEmail: user.email,
   *       department: user.department_name,
   *       role: user.role_name,
   *       location: `${user.city}, ${user.country}`,
   *       experience: user.experience_years,
   *       skills: user.skills,
   *       performance: {
   *         successRate: user.success_rate,
   *         avgCompletionTime: user.avg_completion_time,
   *         qualityScore: user.quality_score
   *       },
   *       engagement: {
   *         avgSessionDuration: user.avg_session_duration,
   *         pagesPerSession: user.pages_per_session,
   *         bounceRate: user.bounce_rate
   *       },
   *       overallScore: user.overall_score,
   *       status: user.active ? 'Active' : 'Inactive',
   *       verified: user.verified ? 'Yes' : 'No'
   *     }));
   *     
   *     return {
   *       reportId: `report_${Date.now()}`,
   *       generatedAt: new Date(),
   *       totalUsers: processedResults.length,
   *       filtersApplied: filters,
   *       summary: {
   *         averageExperience: processedResults.reduce((sum, u) => sum + u.experience, 0) / processedResults.length,
   *         averagePerformance: processedResults.reduce((sum, u) => sum + u.performance.successRate, 0) / processedResults.length,
   *         averageEngagement: processedResults.reduce((sum, u) => sum + u.engagement.avgSessionDuration, 0) / processedResults.length,
   *         topPerformers: processedResults.filter(u => u.overallScore >= 20).length,
   *         activeUsers: processedResults.filter(u => u.status === 'Active').length
   *       },
   *       users: processedResults
   *     };
   *   }
   * }
   */
  async all<U = T>(): Promise<U[]> {
    this.track('all');
    if (simulationManager.isActive()) {
      const virtualData = simulationManager.getStateFor(this.tableName);
      if (virtualData) {
        this.virtualTable = JSON.parse(JSON.stringify(virtualData));
        let results = this.applyWhereClausesToVirtual(this.virtualTable) as unknown as U[];
        const offset = this.offsetValue || 0;
        const limit = this.limitValue === undefined ? results.length : this.limitValue;
        results = results.slice(offset, offset + limit);
        if (!this.includeAllRelations) return results;
        const { attachRelations } = await import('./relations-resolver').catch(() => ({ attachRelations: async (x: any) => x }))
        const selector = typeof this.includeAllRelations === 'function' ? this.includeAllRelations : undefined
        return (await attachRelations(this.tableName, results as any, selector)) as any
      }
      return [];
    }
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    const { sql, bindings } = this.toSql();
    const qbHelper = <X = any>(t?: string) => new QueryBuilder<X>(t || this.tableName);
    eventManager.emit(`querykit:trigger:BEFORE:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'BEFORE', where: undefined, qb: qbHelper } as any);
    const res = await exec.executeQuery(sql, bindings);
    let rows = res.data as U[];
    eventManager.emit(`querykit:trigger:AFTER:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'AFTER', rows, qb: qbHelper } as any);
    if (!this.includeAllRelations) return rows;
    const { attachRelations } = await import('./relations-resolver').catch(() => ({ attachRelations: async (x: any) => x }))
    const selector = typeof this.includeAllRelations === 'function' ? this.includeAllRelations : undefined
    return (await attachRelations(this.tableName, rows as any, selector)) as any
  }
/**
 * Executa a query de forma síncrona.
 * Executa operações de escrita (INSERT, UPDATE, DELETE) e retorna o resultado.
 * Requer que o executor tenha o método runSync implementado.
 * 
 * @returns Resultado da execução da query com informações sobre as mudanças realizadas
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver runSync
 * 
 * @example
 * // Exemplo básico - Executar INSERT
 * const result = new QueryBuilder<User>('users')
 *   .insert({ name: 'John', email: 'john@example.com' })
 *   .run();
 * 
 * console.log(`Inseridos: ${result.changes} registros`);
 * console.log(`ID: ${result.lastInsertRowid}`);
 * 
 * @example
 * // Exemplo intermediário - Executar UPDATE
 * const result = new QueryBuilder<User>('users')
 *   .where('id', '=', 1)
 *   .update({ lastLogin: new Date() })
 *   .run();
 * 
 * if (result.changes > 0) {
 *   console.log('Usuário atualizado com sucesso');
 * } else {
 *   console.log('Nenhum usuário encontrado para atualizar');
 * }
 * 
 * @example
 * // Exemplo avançado - Sistema de auditoria com execução
 * class AuditSystem {
 *   static async logUserAction(
 *     userId: number, 
 *     action: string, 
 *     details: any
 *   ): Promise<void> {
 *     try {
 *       const result = new QueryBuilder<AuditLog>('audit_logs')
 *         .insert({
 *           user_id: userId,
 *           action: action,
 *           details: JSON.stringify(details),
 *           timestamp: new Date(),
 *           ip_address: this.getClientIP()
 *         })
 *         .run();
 *       
 *       // Verifica se o log foi criado com sucesso
 *       if (result.changes === 1) {
 *         console.log(`Ação ${action} registrada para usuário ${userId}`);
 *         
 *         // Emite evento de auditoria
 *         eventManager.emit('audit:action_logged', {
 *           userId,
 *           action,
 *           logId: result.lastInsertRowid,
 *           timestamp: new Date()
 *         });
 *       } else {
 *         throw new Error('Falha ao registrar ação de auditoria');
 *       }
 *     } catch (error) {
 *       console.error('Erro ao registrar auditoria:', error);
 *       // Fallback para log de arquivo
 *       this.fallbackLog(userId, action, details);
 *     }
 *   }
 *   
 *   private static getClientIP(): string {
 *     // Lógica para obter IP do cliente
 *     return '127.0.0.1';
 *   }
 *   
 *   private static fallbackLog(userId: number, action: string, details: any): void {
 *     // Implementação de fallback
 *     console.log(`FALLBACK: ${action} para usuário ${userId}`, details);
 *   }
 * }
 */
  run(): any { const exec = QueryKitConfig.defaultExecutor; if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit'); const { sql, bindings } = this.toSql(); return exec.runSync(sql, bindings); }
  /**
 * Executa a query de forma síncrona e retorna todos os registros.
 * Versão síncrona do método all(), útil para operações que precisam ser executadas
 * de forma bloqueante ou em contextos onde async/await não está disponível.
 * 
 * @template U - Tipo de retorno, por padrão usa o tipo genérico T
 * @returns Array com todos os registros encontrados
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver executeQuerySync
 * 
 * @example
 * // Exemplo básico - Busca síncrona simples
 * const users = new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .allSync();
 * 
 * console.log(`Encontrados ${users.length} usuários ativos`);
 * 
 * @example
 * // Exemplo intermediário - Busca com filtros e ordenação
 * const recentUsers = new QueryBuilder<User>('users')
 *   .where('created_at', '>=', new Date('2024-01-01'))
 *   .orderBy('created_at', 'DESC')
 *   .limit(50)
 *   .allSync();
 * 
 * // Processa resultados imediatamente
 * const userNames = recentUsers.map(user => user.name);
 * console.log('Usuários recentes:', userNames);
 * 
 * @example
 * // Exemplo avançado - Sistema de cache síncrono
 * class SynchronousCacheSystem {
 *   private static cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
 *   
 *   static getCachedData<T>(
 *     cacheKey: string, 
 *     queryBuilder: QueryBuilder<T>, 
 *     ttlMinutes: number = 5
 *   ): T[] {
 *     const cached = this.cache.get(cacheKey);
 *     const now = Date.now();
 *     
 *     // Verifica se o cache é válido
 *     if (cached && (now - cached.timestamp) < (cached.ttl * 60 * 1000)) {
 *       console.log(`Cache hit para chave: ${cacheKey}`);
 *       return cached.data;
 *     }
 *     
 *     // Cache miss ou expirado, executa query síncrona
 *     console.log(`Cache miss para chave: ${cacheKey}, executando query...`);
 *     const data = queryBuilder.allSync();
 *     
 *     // Atualiza cache
 *     this.cache.set(cacheKey, {
 *       data,
 *       timestamp: now,
 *       ttl: ttlMinutes
 *     });
 *     
 *     return data;
 *   }
 *   
 *   static invalidateCache(pattern: string): void {
 *     const keysToDelete = Array.from(this.cache.keys())
 *       .filter(key => key.includes(pattern));
 *     
 *     keysToDelete.forEach(key => {
 *       this.cache.delete(key);
 *       console.log(`Cache invalidado para chave: ${key}`);
 *     });
 *   }
 *   
 *   static getCacheStats(): { totalKeys: number; totalSize: number; oldestEntry: number } {
 *     const now = Date.now();
 *     const oldestEntry = Math.min(...Array.from(this.cache.values()).map(v => v.timestamp));
 *     
 *     return {
 *       totalKeys: this.cache.size,
 *       totalSize: Array.from(this.cache.values()).reduce((sum, v) => sum + JSON.stringify(v.data).length, 0),
 *       oldestEntry: now - oldestEntry
 *     };
 *   }
 * }
 */
  allSync<U = T>(): U[] {
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const { sql, bindings } = this.toSql();
    const qbHelper = <X = any>(t?: string) => new QueryBuilder<X>(t || this.tableName);
    eventManager.emit(`querykit:trigger:BEFORE:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'BEFORE', where: undefined, qb: qbHelper } as any);
    const out = exec.executeQuerySync(sql, bindings).data as U[];
    eventManager.emit(`querykit:trigger:AFTER:READ:${this.tableName}`, { table: this.tableName, action: 'READ', timing: 'AFTER', rows: out, qb: qbHelper } as any);
    return out;
  }
  /**
 * Executa a query de forma síncrona e retorna o primeiro registro encontrado.
 * Versão síncrona do método get(), aplica automaticamente LIMIT 1 para otimização.
 * Útil para buscar um único registro de forma síncrona.
 * 
 * @template U - Tipo de retorno, por padrão usa o tipo genérico T
 * @returns O primeiro registro encontrado ou undefined se nenhum for encontrado
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver executeQuerySync
 * 
 * @example
 * // Exemplo básico - Buscar usuário por ID
 * const user = new QueryBuilder<User>('users')
 *   .where('id', '=', 1)
 *   .getSync();
 * 
 * if (user) {
 *   console.log(`Usuário encontrado: ${user.name}`);
 * } else {
 *   console.log('Usuário não encontrado');
 * }
 * 
 * @example
 * // Exemplo intermediário - Buscar com múltiplos filtros
 * const activeAdmin = new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .where('role', '=', 'admin')
 *   .where('last_login', '>=', new Date('2024-01-01'))
 *   .orderBy('last_login', 'DESC')
 *   .getSync();
 * 
 * if (activeAdmin) {
 *   console.log(`Admin ativo encontrado: ${activeAdmin.name} (último login: ${activeAdmin.last_login})`);
 * }
 * 
 * @example
 * // Exemplo avançado - Sistema de autenticação síncrono
 * class SynchronousAuthSystem {
 *   static authenticateUser(
 *     username: string, 
 *     password: string
 *   ): AuthResult {
 *     try {
 *       // Busca usuário de forma síncrona
 *       const user = new QueryBuilder<User>('users')
 *         .where('username', '=', username)
 *         .where('active', '=', true)
 *         .getSync();
 *       
 *       if (!user) {
 *         return {
 *           success: false,
 *           error: 'Usuário não encontrado ou inativo',
 *           code: 'USER_NOT_FOUND'
 *         };
 *       }
 *       
 *       // Verifica senha
 *       if (!this.verifyPassword(password, user.password_hash)) {
 *         // Registra tentativa de login falhada
 *         this.logFailedLoginAttempt(username);
 *         
 *         return {
 *           success: false,
 *           error: 'Senha incorreta',
 *           code: 'INVALID_PASSWORD'
 *         };
 *       }
 *       
 *       // Atualiza último login
 *       new QueryBuilder<User>('users')
 *         .where('id', '=', user.id)
 *         .update({ 
 *           last_login: new Date(),
 *           login_attempts: 0
 *         })
 *         .run();
 *       
 *       // Gera token de sessão
 *       const sessionToken = this.generateSessionToken(user);
 *       
 *       return {
 *         success: true,
 *         user: {
 *           id: user.id,
 *           username: user.username,
 *           role: user.role,
 *           email: user.email
 *         },
 *         sessionToken,
 *         expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 horas
 *       };
 *     } catch (error) {
 *       console.error('Erro na autenticação:', error);
 *       return {
 *         success: false,
 *         error: 'Erro interno do sistema',
 *         code: 'INTERNAL_ERROR'
 *       };
 *     }
 *   }
 *   
 *   private static verifyPassword(password: string, hash: string): boolean {
 *     // Implementação de verificação de senha
 *     return password === hash; // Simplificado para exemplo
 *   }
 *   
 *   private static logFailedLoginAttempt(username: string): void {
 *     new QueryBuilder<LoginAttempt>('login_attempts')
 *       .insert({
 *         username,
 *         timestamp: new Date(),
 *         ip_address: '127.0.0.1',
 *         success: false
 *       })
 *       .run();
 *   }
 *   
 *   private static generateSessionToken(user: User): string {
 *     // Implementação de geração de token
 *     return `token_${user.id}_${Date.now()}`;
 *   }
 * }
 */
  getSync<U = T>(): U | undefined { this.limit(1); return this.allSync<U>()[0]; }
  /**
 * Executa a query de forma síncrona e retorna o primeiro registro encontrado.
 * Alias para getSync(), mantém consistência com a API fluente.
 * Aplica automaticamente LIMIT 1 para otimização.
 * 
 * @template U - Tipo de retorno, por padrão usa o tipo genérico T
 * @returns O primeiro registro encontrado ou undefined se nenhum for encontrado
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver executeQuerySync
 * 
 * @example
 * // Exemplo básico - Buscar primeiro usuário ativo
 * const firstActiveUser = new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .orderBy('created_at', 'ASC')
 *   .firstSync();
 * 
 * if (firstActiveUser) {
 *   console.log(`Primeiro usuário ativo: ${firstActiveUser.name}`);
 * }
 * 
 * @example
 * // Exemplo intermediário - Buscar com relacionamentos
 * const firstPost = new QueryBuilder<Post>('posts')
 *   .where('published', '=', true)
 *   .orderBy('created_at', 'DESC')
 *   .firstSync();
 * 
 * if (firstPost) {
 *   console.log(`Post mais recente: ${firstPost.title}`);
 *   console.log(`Autor ID: ${firstPost.author_id}`);
 * }
 * 
 * @example
 * // Exemplo avançado - Sistema de filas de trabalho síncrono
 * class SynchronousJobQueue {
 *   static getNextJob(workerId: string, jobTypes: string[]): Job | null {
 *     try {
 *       // Busca próximo job disponível
 *       const nextJob = new QueryBuilder<Job>('jobs')
 *         .where('status', '=', 'pending')
 *         .where('job_type', 'IN', jobTypes)
 *         .where('scheduled_at', '<=', new Date())
 *         .orderBy('priority', 'DESC')
 *         .orderBy('scheduled_at', 'ASC')
 *         .firstSync();
 *       
 *       if (!nextJob) {
 *         console.log('Nenhum job disponível para processar');
 *         return null;
 *       }
 *       
 *       // Marca job como em processamento
 *       const updateResult = new QueryBuilder<Job>('jobs')
 *         .where('id', '=', nextJob.id)
 *         .where('status', '=', 'pending') // Verificação de concorrência
 *         .update({
 *           status: 'processing',
 *           worker_id: workerId,
 *           started_at: new Date()
 *         })
 *         .run();
 *       
 *       if (updateResult.changes === 0) {
 *         // Job foi pego por outro worker
 *         console.log(`Job ${nextJob.id} já foi pego por outro worker`);
 *         return this.getNextJob(workerId, jobTypes); // Tenta novamente
 *       }
 *       
 *       console.log(`Job ${nextJob.id} atribuído ao worker ${workerId}`);
 *       return nextJob;
 *     } catch (error) {
 *       console.error('Erro ao buscar próximo job:', error);
 *       return null;
 *     }
 *   }
 *   
 *   static completeJob(jobId: number, result: any, workerId: string): boolean {
 *     try {
 *       const updateResult = new QueryBuilder<Job>('jobs')
 *         .where('id', '=', jobId)
 *         .where('worker_id', '=', workerId)
 *         .update({
 *           status: 'completed',
 *           completed_at: new Date(),
 *           result: JSON.stringify(result)
 *         })
 *         .run();
 *       
 *       if (updateResult.changes === 1) {
 *         console.log(`Job ${jobId} marcado como completo`);
 *         
 *         // Registra métricas de performance
 *         this.recordJobMetrics(jobId, 'completed');
 *         
 *         return true;
 *       } else {
 *         console.log(`Job ${jobId} não encontrado ou não atribuído ao worker ${workerId}`);
 *         return false;
 *       }
 *     } catch (error) {
 *       console.error('Erro ao completar job:', error);
 *       return false;
 *     }
 *   }
 *   
 *   private static recordJobMetrics(jobId: number, status: string): void {
 *     // Implementação de registro de métricas
 *     console.log(`Métrica registrada: Job ${jobId} - ${status}`);
 *   }
 * }
 */
  firstSync<U = T>(): U | undefined { this.limit(1); return this.getSync<U>(); }
  /**
 * Executa a query de forma síncrona e retorna um array com valores de uma coluna específica.
 * Versão síncrona do método pluck(), útil para extrair valores únicos de uma coluna.
 * 
 * @param column - Nome da coluna para extrair valores
 * @returns Array com os valores da coluna especificada
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver executeQuerySync
 * 
 * @example
 * // Exemplo básico - Extrair nomes de usuários
 * const userNames = new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .pluckSync('name');
 * 
 * console.log('Nomes dos usuários ativos:', userNames);
 * 
 * @example
 * // Exemplo intermediário - Extrair IDs únicos
 * const userIds = new QueryBuilder<User>('users')
 *   .where('role', 'IN', ['admin', 'moderator'])
 *   .where('last_login', '>=', new Date('2024-01-01'))
 *   .pluckSync('id');
 * 
 * console.log(`Encontrados ${userIds.length} usuários privilegiados ativos`);
 * 
 * @example
 * // Exemplo avançado - Sistema de cache de listas
 * class ListCacheSystem {
 *   private static listCache = new Map<string, { data: any[]; timestamp: number; ttl: number }>();
 *   
 *   static getCachedList<T>(
 *     cacheKey: string,
 *     queryBuilder: QueryBuilder<T>,
 *     column: keyof T | string,
 *     ttlMinutes: number = 10
 *   ): any[] {
 *     const cached = this.listCache.get(cacheKey);
 *     const now = Date.now();
 *     
 *     // Verifica se o cache é válido
 *     if (cached && (now - cached.timestamp) < (cached.ttl * 60 * 1000)) {
 *       console.log(`Lista cacheada encontrada para: ${cacheKey}`);
 *       return cached.data;
 *     }
 *     
 *     // Cache miss, executa query síncrona
 *     console.log(`Executando query para lista: ${cacheKey}`);
 *     const data = queryBuilder.pluckSync(column);
 *     
 *     // Atualiza cache
 *     this.listCache.set(cacheKey, {
 *       data,
 *       timestamp: now,
 *       ttl: ttlMinutes
 *     });
 *     
 *     return data;
 *   }
 *   
 *   static getActiveUserIds(): number[] {
 *     return this.getCachedList(
 *       'active_user_ids',
 *       new QueryBuilder<User>('users').where('active', '=', true),
 *       'id',
 *       5 // Cache por 5 minutos
 *     );
 *   }
 *   
 *   static getAvailableCategories(): string[] {
 *     return this.getCachedList(
 *       'available_categories',
 *       new QueryBuilder<Category>('categories').where('active', '=', true),
 *       'name',
 *       30 // Cache por 30 minutos
 *     );
 *   }
 *   
 *   static getRecentProductIds(limit: number = 100): number[] {
 *     return this.getCachedList(
 *       'recent_product_ids',
 *       new QueryBuilder<Product>('products')
 *         .where('active', '=', true)
 *         .orderBy('created_at', 'DESC')
 *         .limit(limit),
 *       'id',
 *       2 // Cache por 2 minutos
 *     );
 *   }
 *   
 *   static invalidateListCache(pattern: string): void {
 *     const keysToDelete = Array.from(this.listCache.keys())
 *       .filter(key => key.includes(pattern));
 *     
 *     keysToDelete.forEach(key => {
 *       this.listCache.delete(key);
 *       console.log(`Lista cacheada invalidada: ${key}`);
 *     });
 *   }
 *   
 *   static getCacheStats(): { totalLists: number; totalItems: number; oldestEntry: number } {
 *     const now = Date.now();
 *     const oldestEntry = Math.min(...Array.from(this.listCache.values()).map(v => v.timestamp));
 *     
 *     return {
 *       totalLists: this.listCache.size,
 *       totalItems: Array.from(this.listCache.values()).reduce((sum, v) => sum + v.data.length, 0),
 *       oldestEntry: now - oldestEntry
 *     };
 *   }
 * }
 */
  pluckSync(column: keyof T | string): any[] { const rows = this.select([String(column)]).allSync<any>(); return rows.map(r => (r as any)[String(column)]); }
  /**
 * Executa a query de forma síncrona e retorna um valor escalar único.
 * Versão síncrona do método scalar(), útil para obter valores únicos como contagens,
 * somas, médias ou qualquer expressão que retorne um único valor.
 * 
 * @template U - Tipo de retorno, por padrão usa any
 * @param alias - Nome da coluna/alias para extrair o valor (opcional)
 * @returns O valor escalar encontrado ou undefined se nenhum for encontrado
 * 
 * @throws Error se nenhum executor estiver configurado ou se não tiver executeQuerySync
 * 
 * @example
 * // Exemplo básico - Contar usuários ativos
 * const activeUserCount = new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .count()
 *   .scalarSync();
 * 
 * console.log(`Total de usuários ativos: ${activeUserCount}`);
 * 
 * @example
 * // Exemplo intermediário - Obter valor com alias específico
 * const totalRevenue = new QueryBuilder<Order>('orders')
 *   .where('status', '=', 'completed')
 *   .where('created_at', '>=', new Date('2024-01-01'))
 *   .sum('total_amount', 'total_revenue')
 *   .scalarSync('total_revenue');
 * 
 * console.log(`Receita total em 2024: R$ ${totalRevenue?.toFixed(2)}`);
 * 
 * @example
 * // Exemplo avançado - Sistema de métricas em tempo real
 * class RealTimeMetricsSystem {
 *   static getSystemMetrics(): SystemMetrics {
 *     try {
 *       const now = new Date();
 *       const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
 *       const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
 *       
 *       // Métricas de usuários
 *       const totalUsers = new QueryBuilder<User>('users').count().scalarSync() || 0;
 *       const activeUsers = new QueryBuilder<User>('users')
 *         .where('active', '=', true)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       const newUsersToday = new QueryBuilder<User>('users')
 *         .where('created_at', '>=', oneDayAgo)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       const onlineUsers = new QueryBuilder<User>('users')
 *         .where('last_activity', '>=', oneHourAgo)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       // Métricas de conteúdo
 *       const totalPosts = new QueryBuilder<Post>('posts').count().scalarSync() || 0;
 *       const publishedPosts = new QueryBuilder<Post>('posts')
 *         .where('published', '=', true)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       const postsToday = new QueryBuilder<Post>('posts')
 *         .where('created_at', '>=', oneDayAgo)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       // Métricas de transações
 *       const totalRevenue = new QueryBuilder<Transaction>('transactions')
 *         .where('status', '=', 'completed')
 *         .sum('amount')
 *         .scalarSync() || 0;
 *       
 *       const revenueToday = new QueryBuilder<Transaction>('transactions')
 *         .where('status', '=', 'completed')
 *         .where('created_at', '>=', oneDayAgo)
 *         .sum('amount')
 *         .scalarSync() || 0;
 *       
 *       // Métricas de performance
 *       const avgResponseTime = new QueryBuilder<ApiLog>('api_logs')
 *         .where('created_at', '>=', oneHourAgo)
 *         .avg('response_time')
 *         .scalarSync() || 0;
 *       
 *       const errorRate = new QueryBuilder<ApiLog>('api_logs')
 *         .where('created_at', '>=', oneHourAgo)
 *         .where('status_code', '>=', 400)
 *         .count()
 *         .scalarSync() || 0;
 *       
 *       const totalRequests = new QueryBuilder<ApiLog>('api_logs')
 *         .where('created_at', '>=', oneHourAgo)
 *         .count()
 *         .scalarSync() || 1; // Evita divisão por zero
 *       
 *       const errorPercentage = (errorRate / totalRequests) * 100;
 *       
 *       const metrics: SystemMetrics = {
 *         timestamp: now,
 *         users: {
 *           total: totalUsers,
 *           active: activeUsers,
 *           newToday: newUsersToday,
 *           online: onlineUsers,
 *           activePercentage: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0
 *         },
 *         content: {
 *           totalPosts,
 *           publishedPosts,
 *           postsToday,
 *           publishRate: totalPosts > 0 ? (publishedPosts / totalPosts) * 100 : 0
 *         },
 *         revenue: {
 *           total: totalRevenue,
 *           today: revenueToday,
 *           dailyAverage: totalRevenue / Math.max(1, Math.ceil((now.getTime() - new Date('2024-01-01').getTime()) / (24 * 60 * 60 * 1000)))
 *         },
 *         performance: {
 *           avgResponseTime,
 *           errorRate: errorPercentage,
 *           successRate: 100 - errorPercentage
 *         }
 *       };
 *       
 *       // Cache das métricas
 *       this.cacheMetrics(metrics);
 *       
 *       return metrics;
 *     } catch (error) {
 *       console.error('Erro ao obter métricas do sistema:', error);
 *       // Retorna métricas em cache ou valores padrão
 *       return this.getCachedMetrics() || this.getDefaultMetrics();
 *     }
 *   }
 *   
 *   private static cacheMetrics(metrics: SystemMetrics): void {
 *     // Implementação de cache de métricas
 *     console.log('Métricas cacheadas:', metrics.timestamp);
 *   }
 *   
 *   private static getCachedMetrics(): SystemMetrics | null {
 *     // Implementação de recuperação de métricas em cache
 *     return null;
 *   }
 *   
 *   private static getDefaultMetrics(): SystemMetrics {
 *     // Métricas padrão em caso de erro
 *     return {
 *       timestamp: new Date(),
 *       users: { total: 0, active: 0, newToday: 0, online: 0, activePercentage: 0 },
 *       content: { totalPosts: 0, publishedPosts: 0, postsToday: 0, publishRate: 0 },
 *       revenue: { total: 0, today: 0, dailyAverage: 0 },
 *       performance: { avgResponseTime: 0, errorRate: 0, successRate: 100 }
 *     };
 *   }
 * }
 * 
 * interface SystemMetrics {
 *   timestamp: Date;
 *   users: {
 *     total: number;
 *     active: number;
 *     newToday: number;
 *     online: number;
 *     activePercentage: number;
 *   };
 *   content: {
 *     totalPosts: number;
 *     publishedPosts: number;
 *     postsToday: number;
 *     publishRate: number;
 *   };
 *   revenue: {
 *     total: number;
 *     today: number;
 *     dailyAverage: number;
 *   };
 *   performance: {
 *     avgResponseTime: number;
 *     errorRate: number;
 *     successRate: number;
 *   };
 * }
 */
  scalarSync<U = any>(alias?: string): U | undefined { const row: any = this.getSync<any>(); if (!row) return undefined; if (alias && row[alias] !== undefined) return row[alias]; const k = Object.keys(row)[0]; return row[k] as U; }

  /**
   * Adiciona uma função de agregação COUNT à query.
   * Útil para contar registros ou valores únicos.
   * 
   * @param column - Coluna para contar (padrão: '*')
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Contar todos os usuários
   * const userCount = await new QueryBuilder<User>('users')
   *   .count()
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Contar usuários ativos por departamento
   * const deptStats = await new QueryBuilder<User>('users')
   *   .select(['department_id'])
   *   .count('id', 'user_count')
   *   .where('active', '=', true)
   *   .groupBy('department_id')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de analytics com múltiplas métricas
   * class UserAnalyticsSystem {
   *   static async generateUserMetrics(
   *     dateRange: DateRange,
   *     segmentFilters: SegmentFilters
   *   ): Promise<UserMetricsReport> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'departments.name as department_name',
   *         'roles.name as role_name',
   *         'locations.country as country',
   *         'locations.region as region'
   *       ])
   *       .count('users.id', 'total_users')
   *       .count('CASE WHEN users.verified = 1 THEN 1 END', 'verified_users')
   *       .count('CASE WHEN users.active = 1 THEN 1 END', 'active_users')
   *       .count('CASE WHEN users.last_login > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END', 'recent_users')
   *       .count('CASE WHEN users.created_at >= ? THEN 1 END', 'new_users')
   *       .count('CASE WHEN users.status = "premium" THEN 1 END', 'premium_users')
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('roles', 'users.role_id = roles.id')
   *       .leftJoin('locations', 'users.location_id = locations.id')
   *       .where('users.created_at', 'BETWEEN', [dateRange.start, dateRange.end]);
   *     
   *     // Aplica filtros de segmentação
   *     if (segmentFilters.departments) {
   *       query = query.whereIn('users.department_id', segmentFilters.departments);
   *     }
   *     
   *     if (segmentFilters.roles) {
   *       query = query.whereIn('users.role_id', segmentFilters.roles);
   *     }
   *     
   *     if (segmentFilters.countries) {
   *       query = query.whereIn('locations.country', segmentFilters.countries);
   *     }
   *     
   *     if (segmentFilters.minExperience) {
   *       query = query.leftJoin('profiles', 'users.id = profiles.user_id')
   *         .where('profiles.experience_years', '>=', segmentFilters.minExperience);
   *     }
   *     
   *     // Aplica agrupamento
   *     query = query.groupBy('users.department_id', 'users.role_id', 'locations.country', 'locations.region');
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('total_users', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalUsers = results.reduce((sum, r) => sum + r.total_users, 0);
   *     const totalVerified = results.reduce((sum, r) => sum + r.verified_users, 0);
   *     const totalActive = results.reduce((sum, r) => sum + r.active_users, 0);
   *     const totalRecent = results.reduce((sum, r) => sum + r.recent_users, 0);
   *     const totalNew = results.reduce((sum, r) => sum + r.new_users, 0);
   *     const totalPremium = results.reduce((sum, r) => sum + r.premium_users, 0);
   *     
   *     return {
   *       reportId: `metrics_${Date.now()}`,
   *       generatedAt: new Date(),
   *       dateRange,
   *       segmentFilters,
   *       summary: {
   *         totalUsers,
   *         totalVerified,
   *         totalActive,
   *         totalRecent,
   *         totalNew,
   *         totalPremium,
   *         verificationRate: (totalVerified / totalUsers) * 100,
   *         activationRate: (totalActive / totalUsers) * 100,
   *         retentionRate: (totalRecent / totalUsers) * 100,
   *         growthRate: (totalNew / totalUsers) * 100,
   *         premiumRate: (totalPremium / totalUsers) * 100
   *       },
   *       breakdown: results.map(row => ({
   *         department: row.department_name,
   *         role: row.role_name,
   *         country: row.country,
   *         region: row.region,
   *         metrics: {
   *           totalUsers: row.total_users,
   *           verifiedUsers: row.verified_users,
   *           activeUsers: row.active_users,
   *           recentUsers: row.recent_users,
   *           newUsers: row.new_users,
   *           premiumUsers: row.premium_users
   *         }
   *       }))
   *     };
   *   }
   * }
   */
  count(column: string = '*', alias?: string): this { return this.addAggregate('count', column, alias); }
  
  /**
   * Adiciona uma função de agregação SUM à query.
   * Útil para somar valores numéricos.
   * 
   * @param column - Coluna numérica para somar
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Somar salários
   * const totalSalary = await new QueryBuilder<User>('users')
   *   .sum('salary', 'total_salary')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Somar vendas por mês
   * const monthlySales = await new QueryBuilder<Sale>('sales')
   *   .select(['MONTH(created_at) as month'])
   *   .sum('amount', 'total_amount')
   *   .where('created_at', '>=', new Date('2024-01-01'))
   *   .groupBy('MONTH(created_at)')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise financeira
   * class FinancialAnalysisSystem {
   *   static async generateRevenueAnalysis(
   *     analysisConfig: RevenueAnalysisConfig
   *   ): Promise<RevenueAnalysisReport> {
   *     let query = new QueryBuilder<Transaction>('transactions')
   *       .select([
   *         'products.category as product_category',
   *         'products.subcategory as product_subcategory',
   *         'customers.segment as customer_segment',
   *         'customers.region as customer_region',
   *         'sales_agents.name as agent_name',
   *         'sales_agents.team as agent_team'
   *       ])
   *       .sum('transactions.amount', 'total_revenue')
   *       .sum('transactions.tax_amount', 'total_tax')
   *       .sum('transactions.discount_amount', 'total_discounts')
   *       .sum('CASE WHEN transactions.status = "completed" THEN transactions.amount ELSE 0 END', 'confirmed_revenue')
   *       .sum('CASE WHEN transactions.payment_method = "credit_card" THEN transactions.amount ELSE 0 END', 'credit_card_revenue')
   *       .sum('CASE WHEN transactions.payment_method = "bank_transfer" THEN transactions.amount ELSE 0 END', 'bank_transfer_revenue')
   *       .leftJoin('products', 'transactions.product_id = products.id')
   *       .leftJoin('customers', 'transactions.customer_id = customers.id')
   *       .leftJoin('sales_agents', 'transactions.agent_id = sales_agents.id')
   *       .where('transactions.created_at', 'BETWEEN', [analysisConfig.startDate, analysisConfig.endDate]);
   *     
   *     // Aplica filtros de análise
   *     if (analysisConfig.productCategories) {
   *       query = query.whereIn('products.category', analysisConfig.productCategories);
   *     }
   *     
   *     if (analysisConfig.customerSegments) {
   *       query = query.whereIn('customers.segment', analysisConfig.customerSegments);
   *     }
   *     
   *     if (analysisConfig.agentTeams) {
   *       query = query.whereIn('sales_agents.team', analysisConfig.agentTeams);
   *     }
   *     
   *     if (analysisConfig.minTransactionAmount) {
   *       query = query.where('transactions.amount', '>=', analysisConfig.minTransactionAmount);
   *     }
   *     
   *     // Aplica agrupamento
   *     query = query.groupBy('products.category', 'products.subcategory', 'customers.segment', 'customers.region', 'sales_agents.team');
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('total_revenue', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalRevenue = results.reduce((sum, r) => sum + r.total_revenue, 0);
   *     const totalTax = results.reduce((sum, r) => sum + r.total_tax, 0);
   *     const totalDiscounts = results.reduce((sum, r) => sum + r.total_discounts, 0);
   *     const confirmedRevenue = results.reduce((sum, r) => sum + r.confirmed_revenue, 0);
   *     
   *     return {
   *       reportId: `revenue_${Date.now()}`,
   *       generatedAt: new Date(),
   *       analysisConfig,
   *       summary: {
   *         totalRevenue,
   *         totalTax,
   *         totalDiscounts,
   *         confirmedRevenue,
   *         netRevenue: totalRevenue - totalTax - totalDiscounts,
   *         confirmationRate: (confirmedRevenue / totalRevenue) * 100,
   *         averageTransactionValue: totalRevenue / results.length
   *       },
   *       breakdown: results.map(row => ({
   *         productCategory: row.product_category,
   *         productSubcategory: row.product_subcategory,
   *         customerSegment: row.customer_segment,
   *         customerRegion: row.customer_region,
   *         agentTeam: row.agent_team,
   *         metrics: {
   *           totalRevenue: row.total_revenue,
   *           totalTax: row.total_tax,
   *           totalDiscounts: row.total_discounts,
   *           confirmedRevenue: row.confirmed_revenue,
   *           netRevenue: row.total_revenue - row.total_tax - row.total_discounts
   *         }
   *       }))
   *     };
   *   }
   * }
   */
  sum(column: string, alias?: string): this { return this.addAggregate('sum', column, alias); }
  
  /**
   * Adiciona uma função de agregação AVG à query.
   * Útil para calcular médias de valores numéricos.
   * 
   * @param column - Coluna numérica para calcular a média
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Calcular média de salários
   * const avgSalary = await new QueryBuilder<User>('users')
   *   .avg('salary', 'average_salary')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Calcular média de vendas por vendedor
   * const agentPerformance = await new QueryBuilder<Sale>('sales')
   *   .select(['agent_id'])
   *   .avg('amount', 'avg_sale_amount')
   *   .count('id', 'total_sales')
   *   .where('created_at', '>=', new Date('2024-01-01'))
   *   .groupBy('agent_id')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de performance
   * class PerformanceAnalysisSystem {
   *   static async analyzeTeamPerformance(
   *     performanceConfig: TeamPerformanceConfig
   *   ): Promise<TeamPerformanceReport> {
   *     let query = new QueryBuilder<Task>('tasks')
   *       .select([
   *         'teams.name as team_name',
   *         'teams.department as team_department',
   *         'projects.name as project_name',
   *         'projects.priority as project_priority',
   *         'task_categories.name as category_name'
   *       ])
   *       .avg('tasks.completion_time_hours', 'avg_completion_time')
   *       .avg('tasks.quality_score', 'avg_quality_score')
   *       .avg('tasks.effort_hours', 'avg_effort_hours')
   *       .avg('CASE WHEN tasks.status = "completed" THEN tasks.completion_time_hours ELSE NULL END', 'avg_completed_time')
   *       .avg('CASE WHEN tasks.quality_score >= 8 THEN tasks.completion_time_hours ELSE NULL END', 'avg_high_quality_time')
   *       .count('tasks.id', 'total_tasks')
   *       .count('CASE WHEN tasks.status = "completed" THEN 1 END', 'completed_tasks')
   *       .count('CASE WHEN tasks.quality_score >= 8 THEN 1 END', 'high_quality_tasks')
   *       .leftJoin('teams', 'tasks.assigned_team_id = teams.id')
   *       .leftJoin('projects', 'tasks.project_id = projects.id')
   *       .leftJoin('task_categories', 'tasks.category_id = task_categories.id')
   *       .where('tasks.created_at', 'BETWEEN', [performanceConfig.startDate, performanceConfig.endDate]);
   *     
   *     // Aplica filtros de performance
   *     if (performanceConfig.teamFilter) {
   *       query = query.whereIn('teams.id', performanceConfig.teamFilter);
   *     }
   *     
   *     if (performanceConfig.projectFilter) {
   *       query = query.whereIn('projects.id', performanceConfig.projectFilter);
   *     }
   *     
   *     if (performanceConfig.categoryFilter) {
   *       query = query.whereIn('task_categories.id', performanceConfig.categoryFilter);
   *     }
   *     
   *     if (performanceConfig.minQualityThreshold) {
   *       query = query.where('tasks.quality_score', '>=', performanceConfig.minQualityThreshold);
   *     }
   *     
   *     // Aplica agrupamento
   *     query = query.groupBy('teams.id', 'projects.id', 'task_categories.id');
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('avg_quality_score', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalTasks = results.reduce((sum, r) => sum + r.total_tasks, 0);
   *     const completedTasks = results.reduce((sum, r) => sum + r.completed_tasks, 0);
   *     const highQualityTasks = results.reduce((sum, r) => sum + r.high_quality_tasks, 0);
   *     
   *     return {
   *       reportId: `performance_${Date.now()}`,
   *       generatedAt: new Date(),
   *       performanceConfig,
   *       summary: {
   *         totalTasks,
   *         completedTasks,
   *         highQualityTasks,
   *         completionRate: (completedTasks / totalTasks) * 100,
   *         qualityRate: (highQualityTasks / completedTasks) * 100,
   *         overallEfficiency: (completedTasks / totalTasks) * (highQualityTasks / completedTasks) * 100
   *       },
   *       teamBreakdown: results.map(row => ({
   *         teamName: row.team_name,
   *         teamDepartment: row.team_department,
   *         projectName: row.project_name,
   *         projectPriority: row.project_priority,
   *         categoryName: row.category_name,
   *         metrics: {
   *           totalTasks: row.total_tasks,
   *           completedTasks: row.completed_tasks,
   *           highQualityTasks: row.high_quality_tasks,
   *           avgCompletionTime: row.avg_completion_time,
   *           avgQualityScore: row.avg_quality_score,
   *           avgEffortHours: row.avg_effort_hours,
   *           avgCompletedTime: row.avg_completed_time,
   *           avgHighQualityTime: row.avg_high_quality_time,
   *           completionRate: (row.completed_tasks / row.total_tasks) * 100,
   *           qualityRate: (row.high_quality_tasks / row.completed_tasks) * 100
   *         }
   *       }))
   *     };
   *   }
   * }
   */
  avg(column: string, alias?: string): this { return this.addAggregate('avg', column, alias); }
  
  /**
   * Adiciona uma função de agregação MIN à query.
   * Útil para encontrar o valor mínimo de uma coluna.
   * 
   * @param column - Coluna para encontrar o valor mínimo
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Encontrar menor salário
   * const minSalary = await new QueryBuilder<User>('users')
   *   .min('salary', 'min_salary')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Encontrar menor preço por categoria
   * const minPrices = await new QueryBuilder<Product>('products')
   *   .select(['category'])
   *   .min('price', 'min_price')
   *   .where('active', '=', true)
   *   .groupBy('category')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de custos
   * class CostAnalysisSystem {
   *   static async analyzeCostOptimization(
   *     costConfig: CostAnalysisConfig
   *   ): Promise<CostOptimizationReport> {
   *     let query = new QueryBuilder<Expense>('expenses')
   *       .select([
   *         'departments.name as department_name',
   *         'expense_categories.name as category_name',
   *         'vendors.name as vendor_name',
   *         'vendors.rating as vendor_rating'
   *       ])
   *       .min('expenses.amount', 'min_expense')
   *       .max('expenses.amount', 'max_expense')
   *       .avg('expenses.amount', 'avg_expense')
   *       .sum('expenses.amount', 'total_expenses')
   *       .count('expenses.id', 'expense_count')
   *       .leftJoin('departments', 'expenses.department_id = departments.id')
   *       .leftJoin('expense_categories', 'expenses.category_id = expense_categories.id')
   *       .leftJoin('vendors', 'expenses.vendor_id = vendors.id')
   *       .where('expenses.created_at', 'BETWEEN', [costConfig.startDate, costConfig.endDate]);
   *     
   *     // Aplica filtros de custo
   *     if (costConfig.departmentFilter) {
   *       query = query.whereIn('expenses.department_id', costConfig.departmentFilter);
   *     }
   *     
   *     if (costConfig.categoryFilter) {
   *       query = query.whereIn('expenses.category_id', costConfig.categoryFilter);
   *     }
   *     
   *     if (costConfig.vendorFilter) {
   *       query = query.whereIn('expenses.vendor_id', costConfig.vendorFilter);
   *     }
   *     
   *     if (costConfig.minAmount) {
   *       query = query.where('expenses.amount', '>=', costConfig.minAmount);
   *     }
   *     
   *     if (costConfig.maxAmount) {
   *       query = query.where('expenses.amount', '<=', costConfig.maxAmount);
   *     }
   *     
   *     // Aplica agrupamento
   *     query = query.groupBy('expenses.department_id', 'expenses.category_id', 'expenses.vendor_id');
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('total_expenses', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalExpenses = results.reduce((sum, r) => sum + r.total_expenses, 0);
   *     const totalCount = results.reduce((sum, r) => sum + r.expense_count, 0);
   *     const globalMin = Math.min(...results.map(r => r.min_expense));
   *     const globalMax = Math.max(...results.map(r => r.max_expense));
   *     const globalAvg = totalExpenses / totalCount;
   *     
   *     return {
   *       reportId: `cost_${Date.now()}`,
   *       generatedAt: new Date(),
   *       costConfig,
   *       summary: {
   *         totalExpenses,
   *         totalCount,
   *         globalMin,
   *         globalMax,
   *         globalAvg,
   *         averageExpensePerCategory: totalExpenses / new Set(results.map(r => r.category_name)).size,
   *         averageExpensePerDepartment: totalExpenses / new Set(results.map(r => r.department_name)).size
   *       },
   *       optimizationOpportunities: results
   *         .filter(row => row.avg_expense > globalAvg * 1.5)
   *         .map(row => ({
   *           department: row.department_name,
   *           category: row.category_name,
   *           vendor: row.vendor_name,
   *           vendorRating: row.vendor_rating,
   *           currentAvg: row.avg_expense,
   *           potentialSavings: (row.avg_expense - globalAvg) * row.expense_count,
   *           recommendation: row.vendor_rating < 3 ? 'Consider alternative vendors' : 'Review pricing structure'
   *         })),
   *       breakdown: results.map(row => ({
   *         department: row.department_name,
   *         category: row.category_name,
   *         vendor: row.vendor_name,
   *         vendorRating: row.vendor_rating,
   *         metrics: {
   *           minExpense: row.min_expense,
   *           maxExpense: row.max_expense,
   *           avgExpense: row.avg_expense,
   *           totalExpenses: row.total_expenses,
   *           expenseCount: row.expense_count
   *         }
   *       }))
   *     };
   *   }
   * }
   */
  min(column: string, alias?: string): this { return this.addAggregate('min', column, alias); }
  
  /**
   * Adiciona uma função de agregação MAX à query.
   * Útil para encontrar o valor máximo de uma coluna.
   * 
   * @param column - Coluna para encontrar o valor máximo
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Encontrar maior salário
   * const maxSalary = await new QueryBuilder<User>('users')
   *   .max('salary', 'max_salary')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Encontrar maior preço por categoria
   * const maxPrices = await new QueryBuilder<Product>('products')
   *   .select(['category'])
   *   .max('price', 'max_price')
   *   .where('active', '=', true)
   *   .groupBy('category')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de performance máxima
   * class PeakPerformanceSystem {
   *   static async analyzePeakPerformance(
   *     performanceConfig: PeakPerformanceConfig
   *   ): Promise<PeakPerformanceReport> {
   *     let query = new QueryBuilder<Performance>('performance_metrics')
   *       .select([
   *         'teams.name as team_name',
   *         'projects.name as project_name',
   *         'performance_types.name as metric_type',
   *         'time_periods.name as period_name'
   *       ])
   *       .max('performance_metrics.value', 'peak_value')
   *       .max('performance_metrics.achieved_at', 'peak_timestamp')
   *       .avg('performance_metrics.value', 'avg_value')
   *       .min('performance_metrics.value', 'min_value')
   *       .count('performance_metrics.id', 'measurement_count')
   *       .leftJoin('teams', 'performance_metrics.team_id = teams.id')
   *       .leftJoin('projects', 'performance_metrics.project_id = projects.id')
   *       .leftJoin('performance_types', 'performance_metrics.type_id = performance_types.id')
   *       .leftJoin('time_periods', 'performance_metrics.period_id = time_periods.id')
   *       .where('performance_metrics.measured_at', 'BETWEEN', [performanceConfig.startDate, performanceConfig.endDate]);
   *     
   *     // Aplica filtros de performance
   *     if (performanceConfig.teamFilter) {
   *       query = query.whereIn('performance_metrics.team_id', performanceConfig.teamFilter);
   *     }
   *     
   *     if (performanceConfig.projectFilter) {
   *       query = query.whereIn('performance_metrics.project_id', performanceConfig.projectFilter);
   *     }
   *     
   *     if (performanceConfig.metricTypeFilter) {
   *       query = query.whereIn('performance_metrics.type_id', performanceConfig.metricTypeFilter);
   *     }
   *     
   *     if (performanceConfig.minValueThreshold) {
   *       query = query.where('performance_metrics.value', '>=', performanceConfig.minValueThreshold);
   *     }
   *     
   *     // Aplica agrupamento
   *     query = query.groupBy('performance_metrics.team_id', 'performance_metrics.project_id', 'performance_metrics.type_id', 'performance_metrics.period_id');
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('peak_value', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalMeasurements = results.reduce((sum, r) => sum + r.measurement_count, 0);
   *     const globalPeak = Math.max(...results.map(r => r.peak_value));
   *     const globalMin = Math.min(...results.map(r => r.min_value));
   *     const globalAvg = results.reduce((sum, r) => sum + r.avg_value, 0) / results.length;
   *     
   *     return {
   *       reportId: `peak_${Date.now()}`,
   *       generatedAt: new Date(),
   *       performanceConfig,
   *       summary: {
   *         totalMeasurements,
   *         globalPeak,
   *         globalMin,
   *         globalAvg,
   *         peakToAverageRatio: globalPeak / globalAvg,
   *         peakToMinRatio: globalPeak / globalMin,
   *         consistencyScore: (globalAvg / globalPeak) * 100
   *       },
   *       peakPerformers: results
   *         .filter(row => row.peak_value >= globalPeak * 0.9)
   *         .map(row => ({
   *           team: row.team_name,
   *           project: row.project_name,
   *           metricType: row.metric_type,
   *           period: row.period_name,
   *           peakValue: row.peak_value,
   *           peakTimestamp: row.peak_timestamp,
   *           avgValue: row.avg_value,
   *           minValue: row.min_value,
   *           measurementCount: row.measurement_count,
   *           performanceRatio: row.peak_value / row.avg_value
   *         })),
   *       breakdown: results.map(row => ({
   *         team: row.team_name,
   *         project: row.project_name,
   *         metricType: row.metric_type,
   *         period: row.period_name,
   *         metrics: {
   *           peakValue: row.peak_value,
   *           peakTimestamp: row.peak_timestamp,
   *           avgValue: row.avg_value,
   *           minValue: row.min_value,
   *           measurementCount: row.measurement_count
   *         }
   *       }))
   *     };
   *   }
   * }
   */
  max(column: string, alias?: string): this { return this.addAggregate('max', column, alias); }
  
  /**
   * Método interno para adicionar funções de agregação.
   * Não deve ser chamado diretamente, use os métodos específicos (count, sum, avg, min, max).
   * 
   * @param func - Função de agregação a ser aplicada
   * @param column - Coluna para aplicar a agregação
   * @param alias - Alias para o resultado da agregação
   * @returns Instância atual do QueryBuilder para method chaining
   */
  private addAggregate(func: Aggregate['func'], column: string, alias?: string) { this.aggregates.push({ func, column, alias: alias || `${func}_${column}` }); return this; }

  /**
   * Adiciona uma expressão SQL personalizada à seleção.
   * Útil para cálculos complexos ou funções SQL específicas.
   * 
   * @param expression - Expressão SQL a ser adicionada
   * @param alias - Alias opcional para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Expressão simples
   * const result = await new QueryBuilder<User>('users')
   *   .selectExpression('LENGTH(name)', 'name_length')
   *   .get();
   * 
   * @example
   * // Exemplo intermediário - Cálculo com CASE
   * const users = await new QueryBuilder<User>('users')
   *   .selectExpression('CASE WHEN age >= 18 THEN "adult" ELSE "minor" END', 'age_group')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de scoring complexo
   * class UserScoringSystem {
   *   static async calculateUserScores(): Promise<UserScore[]> {
   *     const query = new QueryBuilder<User>('users')
   *       .selectExpression(`
   *         CASE 
   *           WHEN users.verified = 1 THEN 10 
   *           ELSE 0 
   *         END + 
   *         CASE 
   *           WHEN users.active = 1 THEN 5 
   *           ELSE 0 
   *         END + 
   *         CASE 
   *           WHEN profiles.experience_years >= 5 THEN 3 
   *           WHEN profiles.experience_years >= 2 THEN 2 
   *           ELSE 1 
   *         END + 
   *         CASE 
   *           WHEN users.last_login > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 2 
   *           ELSE 0 
   *         END
   *       `, 'total_score')
   *       .leftJoin('profiles', 'users.id = profiles.user_id');
   *     
   *     return await query.all();
   *   }
   * }
   */
  /**
   * Adiciona uma expressão SQL customizada à seleção.
   * Permite incluir funções SQL, cálculos ou expressões complexas.
   * 
   * @param expression - Expressão SQL a ser incluída na seleção
   * @param alias - Alias opcional para a expressão
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Expressão SQL simples
   * const users = await new QueryBuilder<User>('users')
   *   .selectExpression('UPPER(name)', 'name_upper')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Cálculos e funções
   * const userStats = await new QueryBuilder<User>('users')
   *   .selectExpression('DATEDIFF(NOW(), created_at)', 'days_since_creation')
   *   .selectExpression('CASE WHEN active = 1 THEN "Active" ELSE "Inactive" END', 'status_text')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Expressões complexas
   * const advancedStats = await new QueryBuilder<User>('users')
   *   .selectExpression(`
   *     (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) as post_count
   *   `)
   *   .selectExpression(`
   *     CASE 
   *       WHEN experience_years >= 5 THEN "Senior"
   *       WHEN experience_years >= 2 THEN "Intermediate"
   *       ELSE "Junior"
   *     END as experience_level
   *   `)
   *   .all();
   */
  selectExpression(expression: string, alias?: string): this { const expr = alias ? `${expression} AS ${alias}` : expression; this.selectColumns.push(raw(expr)); return this; }
  /**
   * Adiciona uma função COUNT à seleção.
   * Atalho para selectExpression com COUNT.
   * 
   * @param column - Coluna para contar (padrão: '*')
   * @param alias - Alias para o resultado (padrão: 'count')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Contar registros
   * const users = await new QueryBuilder<User>('users')
   *   .selectCount('id', 'total_users')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Contar com condições
   * const stats = await new QueryBuilder<User>('users')
   *   .selectCount('id', 'total_users')
   *   .selectCount('CASE WHEN active = 1 THEN 1 END', 'active_users')
   *   .where('created_at', '>', new Date('2024-01-01'))
   *   .all();
   */
  selectCount(column: string = '*', alias: string = 'count'): this { return this.selectExpression(`COUNT(${column})`, alias); }
  /**
   * Adiciona uma função SUM à seleção.
   * Atalho para selectExpression com SUM.
   * 
   * @param column - Coluna para somar
   * @param alias - Alias para o resultado (padrão: 'sum')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Somar valores
   * const stats = await new QueryBuilder<Order>('orders')
   *   .selectSum('total_amount', 'total_revenue')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Somar com condições
   * const revenue = await new QueryBuilder<Order>('orders')
   *   .selectSum('total_amount', 'total_revenue')
   *   .selectSum('CASE WHEN status = "completed" THEN total_amount ELSE 0 END', 'completed_revenue')
   *   .where('created_at', '>', new Date('2024-01-01'))
   *   .all();
   */
  selectSum(column: string, alias: string = 'sum'): this { return this.selectExpression(`SUM(${column})`, alias); }
  /**
   * Adiciona uma função AVG à seleção.
   * Atalho para selectExpression com AVG.
   * 
   * @param column - Coluna para calcular a média
   * @param alias - Alias para o resultado (padrão: 'avg')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Calcular média
   * const stats = await new QueryBuilder<User>('users')
   *   .selectAvg('age', 'average_age')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Média com condições
   * const performance = await new QueryBuilder<Employee>('employees')
   *   .selectAvg('salary', 'avg_salary')
   *   .selectAvg('CASE WHEN department = "IT" THEN salary END', 'it_avg_salary')
   *   .selectAvg('CASE WHEN experience_years >= 5 THEN salary END', 'senior_avg_salary')
   *   .all();
   */
  selectAvg(column: string, alias: string = 'avg'): this { return this.selectExpression(`AVG(${column})`, alias); }
  /**
   * Adiciona uma função MIN à seleção.
   * Atalho para selectExpression com MIN.
   * 
   * @param column - Coluna para encontrar o valor mínimo
   * @param alias - Alias para o resultado (padrão: 'min')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Encontrar valor mínimo
   * const stats = await new QueryBuilder<Product>('products')
   *   .selectMin('price', 'lowest_price')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Mínimo com condições
   * const analysis = await new QueryBuilder<Sale>('sales')
   *   .selectMin('amount', 'min_sale')
   *   .selectMin('CASE WHEN region = "North" THEN amount END', 'north_min_sale')
   *   .selectMin('CASE WHEN product_category = "Electronics" THEN amount END', 'electronics_min_sale')
   *   .all();
   */
  selectMin(column: string, alias: string = 'min'): this { return this.selectExpression(`MIN(${column})`, alias); }
  /**
   * Adiciona uma função MAX à seleção.
   * Atalho para selectExpression com MAX.
   * 
   * @param column - Coluna para encontrar o valor máximo
   * @param alias - Alias para o resultado (padrão: 'max')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Encontrar valor máximo
   * const stats = await new QueryBuilder<Product>('products')
   *   .selectMax('price', 'highest_price')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Máximo com condições
   * const analysis = await new QueryBuilder<Sale>('sales')
   *   .selectMax('amount', 'max_sale')
   *   .selectMax('CASE WHEN region = "South" THEN amount END', 'south_max_sale')
   *   .selectMax('CASE WHEN product_category = "Clothing" THEN amount END', 'clothing_max_sale')
   *   .all();
   */
  selectMax(column: string, alias: string = 'max'): this { return this.selectExpression(`MAX(${column})`, alias); }
  /**
   * Adiciona uma soma condicional à seleção.
   * Conta registros que atendem a uma condição específica.
   * 
   * @param conditionSql - Condição SQL para o CASE WHEN
   * @param alias - Alias para o resultado
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Contar registros condicionalmente
   * const stats = await new QueryBuilder<User>('users')
   *   .selectCaseSum('active = 1', 'active_count')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas contagens condicionais
   * const analysis = await new QueryBuilder<Order>('orders')
   *   .selectCaseSum('status = "completed"', 'completed_orders')
   *   .selectCaseSum('status = "pending"', 'pending_orders')
   *   .selectCaseSum('total_amount > 100', 'high_value_orders')
   *   .all();
   */
  selectCaseSum(conditionSql: string, alias: string): this { return this.selectExpression(`SUM(CASE WHEN ${conditionSql} THEN 1 ELSE 0 END)`, alias); }
  /**
   * Adiciona uma coluna única ao GROUP BY.
   * Atalho para groupBy com uma única coluna.
   * 
   * @param column - Coluna para agrupar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Agrupar por uma coluna
   * const stats = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as user_count'])
   *   .groupByOne('department')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Agrupar com agregações
   * const analysis = await new QueryBuilder<Order>('orders')
   *   .select(['customer_id', 'COUNT(*) as order_count', 'SUM(total_amount) as total_spent'])
   *   .groupByOne('customer_id')
   *   .having('order_count', '>', 1)
   *   .all();
   */
  groupByOne(column: keyof T | string): this { return this.groupBy([String(column)]); }
  /**
   * Aplica paginação à query com página e itens por página.
   * Calcula automaticamente LIMIT e OFFSET baseado nos parâmetros.
   * 
   * @param page - Número da página (começa em 1)
   * @param perPage - Itens por página (padrão: 25)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Primeira página com 10 itens
   * const firstPage = await new QueryBuilder<User>('users')
   *   .paginate(1, 10)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Paginação com filtros
   * const activeUsersPage2 = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orderBy('created_at', 'DESC')
   *   .paginate(2, 20)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de paginação inteligente
   * class SmartPaginationSystem {
   *   static async getPaginatedResults<T>(
   *     query: QueryBuilder<T>,
   *     paginationConfig: PaginationConfig
   *   ): Promise<PaginatedResult<T>> {
   *     // Calcula total de registros para paginação
   *     const totalQuery = query.clone();
   *     const totalResult = await totalQuery.count().get();
   *     const total = totalResult?.count || 0;
   *     
   *     // Calcula informações de paginação
   *     const totalPages = Math.ceil(total / paginationConfig.perPage);
   *     const currentPage = Math.min(paginationConfig.page, totalPages);
   *     const safePage = Math.max(1, currentPage);
   *     
   *     // Aplica paginação
   *     const paginatedQuery = query.clone()
   *       .orderBy(paginationConfig.sortBy, paginationConfig.sortDirection)
   *       .paginate(safePage, paginationConfig.perPage);
   *     
   *     const results = await paginatedQuery.all();
   *     
   *     return {
   *       data: results,
   *       pagination: {
   *         currentPage: safePage,
   *         perPage: paginationConfig.perPage,
   *         total,
   *         totalPages,
   *         hasNextPage: safePage < totalPages,
   *         hasPrevPage: safePage > 1,
   *         nextPage: safePage < totalPages ? safePage + 1 : null,
   *         prevPage: safePage > 1 ? safePage - 1 : null
   *       }
   *     };
   *   }
   * }
   */
  paginate(page: number = 1, perPage: number = 25): this { const safePage = Math.max(1, page || 1); const safePerPage = Math.max(1, perPage || 25); this.limit(safePerPage); this.offset((safePage - 1) * safePerPage); return this; }
  /**
   * Adiciona filtro de intervalo de datas à query.
   * Permite filtrar registros dentro de um período específico.
   * 
   * @param field - Campo de data para filtrar
   * @param start - Data de início do intervalo (opcional)
   * @param end - Data de fim do intervalo (opcional)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Intervalo de datas
   * const users = await new QueryBuilder<User>('users')
   *   .range('created_at', new Date('2024-01-01'), new Date('2024-12-31'))
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Apenas data de início
   * const recentUsers = await new QueryBuilder<User>('users')
   *   .range('created_at', new Date('2024-01-01'))
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios por período
   * class PeriodReportSystem {
   *   static async generatePeriodReport(
   *     startDate: Date,
   *     endDate: Date,
   *     reportType: string
   *   ): Promise<PeriodReport> {
   *     let query = new QueryBuilder<Activity>('user_activities')
   *       .range('activity_date', startDate, endDate);
   *     
   *     if (reportType === 'daily') {
   *       query = query.groupBy('DATE(activity_date)');
   *     } else if (reportType === 'weekly') {
   *       query = query.groupBy('YEARWEEK(activity_date)');
   *     } else if (reportType === 'monthly') {
   *       query = query.groupBy('DATE_FORMAT(activity_date, "%Y-%m")');
   *     }
   *     
   *     const results = await query
   *       .select(['activity_date', 'COUNT(*) as activity_count'])
   *       .orderBy('activity_date', 'ASC')
   *       .all();
   *     
   *     return {
   *       period: { start: startDate, end: endDate },
   *       reportType,
   *       data: results,
   *       totalActivities: results.reduce((sum, r) => sum + r.activity_count, 0)
   *     };
   *   }
   * }
   */
  range(field: keyof T | string, start?: Date, end?: Date): this { if (start) this.whereRaw(`${String(field)} >= ?`, [start.toISOString()]); if (end) this.whereRaw(`${String(field)} <= ?`, [end.toISOString()]); return this; }
  /**
   * Adiciona filtro de período relativo à data atual.
   * Permite filtrar registros dos últimos 24h, 7 dias, 30 dias ou período customizado.
   * 
   * @param field - Campo de data para filtrar
   * @param periodKey - Chave do período ('24h', '7d', '30d' ou string customizado)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Últimas 24 horas
   * const recentUsers = await new QueryBuilder<User>('users')
   *   .period('created_at', '24h')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Últimos 7 dias
   * const weeklyActivity = await new QueryBuilder<Activity>('user_activities')
   *   .period('activity_date', '7d')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise temporal
   * class TemporalAnalysisSystem {
   *   static async analyzeUserActivity(
   *     periodKey: '24h' | '7d' | '30d',
   *     activityType: string
   *   ): Promise<TemporalAnalysis> {
   *     let query = new QueryBuilder<UserActivity>('user_activities')
   *       .period('created_at', periodKey)
   *       .where('activity_type', '=', activityType);
   *     
   *     const results = await query
   *       .select([
   *         'DATE(created_at) as date',
   *         'HOUR(created_at) as hour',
   *         'COUNT(*) as activity_count'
   *       ])
   *       .groupBy('DATE(created_at)', 'HOUR(created_at)')
   *       .orderBy('date', 'ASC')
   *       .orderBy('hour', 'ASC')
   *       .all();
   *     
   *     return {
   *       period: periodKey,
   *       activityType,
   *       data: results,
   *       totalActivities: results.reduce((sum, r) => sum + r.activity_count, 0),
   *       peakHour: this.findPeakHour(results),
   *       averageDailyActivity: this.calculateAverageDailyActivity(results, periodKey)
   *     };
   *   }
   * }
   */
  period(field: keyof T | string, periodKey?: '24h' | '7d' | '30d' | string): this { if (!periodKey) return this; const now = new Date(); let startDate: Date; switch (periodKey) { case '24h': startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); break; case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break; case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break; default: startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); } return this.whereRaw(`${String(field)} >= ?`, [startDate.toISOString()]); }

  /**
   * Adiciona uma cláusula WHERE LIKE para busca de texto.
   * Permite busca com wildcards (% e _) para padrões de texto.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param pattern - Padrão de busca com wildcards
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca simples
   * const users = await new QueryBuilder<User>('users')
   *   .whereLike('name', '%john%')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas buscas LIKE
   * const users = await new QueryBuilder<User>('users')
   *   .whereLike('name', '%john%')
   *   .whereLike('email', '%@gmail.com')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca com padrões
   * class PatternSearchSystem {
   *   static async searchUsersByPattern(
   *     searchPatterns: SearchPattern[]
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users');
   *     
   *     searchPatterns.forEach(pattern => {
   *       switch (pattern.type) {
   *         case 'contains':
   *           query = query.whereLike(pattern.field, `%${pattern.value}%`);
   *           break;
   *         case 'starts_with':
   *           query = query.whereLike(pattern.field, `${pattern.value}%`);
   *           break;
   *         case 'ends_with':
   *           query = query.whereLike(pattern.field, `%${pattern.value}`);
   *           break;
   *         case 'exact_match':
   *           query = query.where(pattern.field, '=', pattern.value);
   *           break;
   *       }
   *     });
   *     
   *     return await query
   *       .orderBy('name', 'ASC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereLike(column: keyof T | string, pattern: string): this { return this.where(column as any, 'LIKE', pattern); }
  /**
   * Adiciona uma cláusula OR WHERE LIKE para busca de texto.
   * Conecta com OR às condições anteriores.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param pattern - Padrão de busca com wildcards
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Condição OR LIKE simples
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .orWhereLike('name', '%john%')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições OR LIKE
   * const users = await new QueryBuilder<User>('users')
   *   .where('verified', '=', true)
   *   .orWhereLike('name', '%john%')
   *   .orWhereLike('email', '%@gmail.com')
   *   .orWhereLike('username', '%admin%')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca flexível
   * class FlexibleSearchSystem {
   *   static async searchUsersFlexibly(
   *     searchTerm: string,
   *     searchFields: string[]
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Aplica busca OR em múltiplos campos
   *     searchFields.forEach(field => {
   *       query = query.orWhereLike(field, `%${searchTerm}%`);
   *     });
   *     
   *     return await query
   *       .orderBy('name', 'ASC')
   *       .limit(50)
   *       .all();
   *   }
   * }
   */
  orWhereLike(column: keyof T | string, pattern: string): this { return this.orWhere(column as any, 'LIKE', pattern); }
  /**
   * Adiciona uma cláusula WHERE LIKE para buscar texto que contenha um termo.
   * Atalho para whereLike com wildcards %term%.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param term - Termo a ser buscado (pode estar em qualquer posição)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar termo em qualquer posição
   * const users = await new QueryBuilder<User>('users')
   *   .whereContains('name', 'john')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas buscas contains
   * const users = await new QueryBuilder<User>('users')
   *   .whereContains('name', 'john')
   *   .whereContains('bio', 'developer')
   *   .whereContains('skills', 'javascript')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca de conteúdo
   * class ContentSearchSystem {
   *   static async searchContentByKeywords(
   *     keywords: string[],
   *     contentFields: string[]
   *   ): Promise<Content[]> {
   *     let query = new QueryBuilder<Content>('content')
   *       .where('published', '=', true);
   *     
   *     // Busca por qualquer uma das palavras-chave em qualquer campo
   *     keywords.forEach(keyword => {
   *       contentFields.forEach(field => {
   *         query = query.orWhereContains(field, keyword);
   *       });
   *     });
   *     
   *     return await query
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereContains(column: keyof T | string, term: string): this { return this.whereLike(column, `%${term}%`); }
  /**
   * Adiciona uma cláusula WHERE LIKE para buscar texto que comece com um prefixo.
   * Atalho para whereLike com wildcards prefix%.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param prefix - Prefixo que o texto deve começar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar por prefixo
   * const users = await new QueryBuilder<User>('users')
   *   .whereStartsWith('name', 'john')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos prefixos
   * const users = await new QueryBuilder<User>('users')
   *   .whereStartsWith('email', 'admin')
   *   .whereStartsWith('username', 'user')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca hierárquica
   * class HierarchicalSearchSystem {
   *   static async searchByHierarchy(
   *     hierarchyLevels: string[],
   *     searchTerm: string
   *   ): Promise<HierarchicalItem[]> {
   *     let query = new QueryBuilder<HierarchicalItem>('hierarchical_items')
   *       .where('active', '=', true);
   *     
   *     // Busca por hierarquia de prefixos
   *     hierarchyLevels.forEach((level, index) => {
   *       const prefix = hierarchyLevels.slice(0, index + 1).join('.');
   *       query = query.whereStartsWith('path', prefix);
   *     });
   *     
   *     if (searchTerm) {
   *       query = query.whereContains('name', searchTerm);
   *     }
   *     
   *     return await query
   *       .orderBy('path', 'ASC')
   *       .limit(200)
   *       .all();
   *   }
   * }
   */
  whereStartsWith(column: keyof T | string, prefix: string): this { return this.whereLike(column, `${prefix}%`); }
  /**
   * Adiciona uma cláusula WHERE LIKE para buscar texto que termine com um sufixo.
   * Atalho para whereLike com wildcards %suffix.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param suffix - Sufixo que o texto deve terminar
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar por sufixo
   * const users = await new QueryBuilder<User>('users')
   *   .whereEndsWith('email', '@gmail.com')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos sufixos
   * const users = await new QueryBuilder<User>('users')
   *   .whereEndsWith('email', '@gmail.com')
   *   .whereEndsWith('username', 'admin')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca por domínios
   * class DomainSearchSystem {
   *   static async searchByDomain(
   *     allowedDomains: string[],
   *     excludeDomains: string[]
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Inclui domínios permitidos
   *     allowedDomains.forEach(domain => {
   *       query = query.orWhereEndsWith('email', `@${domain}`);
   *     });
   *     
   *     // Exclui domínios bloqueados
   *     excludeDomains.forEach(domain => {
   *       query = query.whereNotLike('email', `%@${domain}`);
   *     });
   *     
   *     return await query
   *       .orderBy('email', 'ASC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereEndsWith(column: keyof T | string, suffix: string): this { return this.whereLike(column, `%${suffix}`); }
  whereILike(column: keyof T | string, pattern: string): this { 
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    
    if (executor?.dialect === 'postgres') {
      // PostgreSQL - ILIKE para case-insensitive
      sql = `${String(column)} ILIKE ?`;
    } else if (executor?.dialect === 'mysql') {
      // MySQL - COLLATE para case-insensitive
      sql = `${String(column)} LIKE ? COLLATE utf8_general_ci`;
    } else if (executor?.dialect === 'oracle') {
      // Oracle - UPPER() para case-insensitive
      sql = `UPPER(${String(column)}) LIKE UPPER(?)`;
    } else if (executor?.dialect === 'mssql') {
      // SQL Server - COLLATE para case-insensitive
      sql = `${String(column)} LIKE ? COLLATE SQL_Latin1_General_CP1_CI_AS`;
    } else {
      // Fallback universal - LOWER() para case-insensitive
      sql = `LOWER(${String(column)}) LIKE LOWER(?)`;
    }
    
    return this.whereRaw(sql, [pattern]); 
  }
  /**
   * Adiciona uma cláusula WHERE ILIKE para buscar texto que contenha um termo (case-insensitive).
   * Atalho para whereILike com wildcards %term%.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param term - Termo a ser buscado (pode estar em qualquer posição, ignorando maiúsculas/minúsculas)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar termo case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereContainsCI('name', 'john')
   *   .all(); // Encontra "John", "JOHN", "john", etc.
   * 
   * @example
   * // Exemplo intermediário - Múltiplas buscas case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereContainsCI('name', 'john')
   *   .whereContainsCI('bio', 'developer')
   *   .whereContainsCI('skills', 'javascript')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca flexível
   * class FlexibleSearchSystem {
   *   static async searchUsersFlexibly(
   *     searchTerms: string[],
   *     searchFields: string[]
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .where('active', '=', true);
   *     
   *     // Busca case-insensitive em múltiplos campos
   *     searchTerms.forEach(term => {
   *       searchFields.forEach(field => {
   *         query = query.orWhereContainsCI(field, term);
   *       });
   *     });
   *     
   *     return await query
   *       .orderBy('name', 'ASC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereContainsCI(column: keyof T | string, term: string): this { return this.whereILike(column, `%${term}%`); }
  /**
   * Adiciona uma cláusula WHERE ILIKE para buscar texto que comece com um prefixo (case-insensitive).
   * Atalho para whereILike com wildcards prefix%.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param prefix - Prefixo que o texto deve começar (ignorando maiúsculas/minúsculas)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar por prefixo case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereStartsWithCI('name', 'john')
   *   .all(); // Encontra "John", "JOHN", "john", etc.
   * 
   * @example
   * // Exemplo intermediário - Múltiplos prefixos case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereStartsWithCI('email', 'admin')
   *   .whereStartsWithCI('username', 'user')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca por categorias
   * class CategorySearchSystem {
   *   static async searchByCategoryPrefix(
   *     categoryPrefixes: string[],
   *     searchTerm: string
   *   ): Promise<Category[]> {
   *     let query = new QueryBuilder<Category>('categories')
   *       .where('active', '=', true);
   *     
   *     // Busca por prefixos de categoria case-insensitive
   *     categoryPrefixes.forEach(prefix => {
   *       query = query.orWhereStartsWithCI('category_code', prefix);
   *     });
   *     
   *     if (searchTerm) {
   *       query = query.whereContainsCI('name', searchTerm);
   *     }
   *     
   *     return await query
   *       .orderBy('category_code', 'ASC')
   *       .limit(100)
   *       .all();
   *   }
   * }
   */
  whereStartsWithCI(column: keyof T | string, prefix: string): this { return this.whereILike(column, `${prefix}%`); }
  /**
   * Adiciona uma cláusula WHERE ILIKE para buscar texto que termine com um sufixo (case-insensitive).
   * Atalho para whereILike com wildcards %suffix.
   * 
   * @param column - Nome da coluna ou chave do tipo T para buscar
   * @param suffix - Sufixo que o texto deve terminar (ignorando maiúsculas/minúsculas)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Buscar por sufixo case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereEndsWithCI('email', '@gmail.com')
   *   .all(); // Encontra "@gmail.com", "@GMAIL.COM", etc.
   * 
   * @example
   * // Exemplo intermediário - Múltiplos sufixos case-insensitive
   * const users = await new QueryBuilder<User>('users')
   *   .whereEndsWithCI('email', '@gmail.com')
   *   .whereEndsWithCI('username', 'admin')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca por extensões de arquivo
   * class FileExtensionSearchSystem {
   *   static async searchByFileExtensions(
   *     allowedExtensions: string[],
   *     excludeExtensions: string[]
   *   ): Promise<File[]> {
   *     let query = new QueryBuilder<File>('files')
   *       .where('active', '=', true);
   *     
   *     // Inclui extensões permitidas case-insensitive
   *     allowedExtensions.forEach(ext => {
   *       query = query.orWhereEndsWithCI('filename', `.${ext}`);
   *     });
   *     
   *     // Exclui extensões bloqueadas case-insensitive
   *     excludeExtensions.forEach(ext => {
   *       query = query.whereNotLike('filename', `%.${ext}`);
   *     });
   *     
   *     return await query
   *       .orderBy('filename', 'ASC')
   *       .limit(200)
   *       .all();
   *   }
   * }
   */
  whereEndsWithCI(column: keyof T | string, suffix: string): this { return this.whereILike(column, `%${suffix}`); }
  /**
   * Adiciona uma busca de texto em múltiplas colunas.
   * Atalho para whereRawSearch com busca em múltiplas colunas.
   * 
   * @param searchTerm - Termo a ser buscado
   * @param columns - Array de colunas onde buscar o termo
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca em múltiplas colunas
   * const users = await new QueryBuilder<User>('users')
   *   .whereSearch('john', ['name', 'email', 'username'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca com filtros adicionais
   * const users = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereSearch('developer', ['name', 'bio', 'skills', 'title'])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca global
   * class GlobalSearchSystem {
   *   static async performGlobalSearch(
   *     searchTerm: string,
   *     searchConfig: SearchConfig
   *   ): Promise<GlobalSearchResult[]> {
   *     const results: GlobalSearchResult[] = [];
   *     
   *     // Busca em usuários
   *     if (searchConfig.includeUsers) {
   *       const users = await new QueryBuilder<User>('users')
   *         .where('active', '=', true)
   *         .whereSearch(searchTerm, ['name', 'email', 'bio', 'skills'])
   *         .limit(50)
   *         .all();
   *       
   *       results.push(...users.map(user => ({
   *         type: 'user',
   *         id: user.id,
   *         title: user.name,
   *         description: user.bio,
   *         relevance: this.calculateRelevance(user, searchTerm)
   *       })));
   *     }
   *     
   *     // Busca em posts
   *     if (searchConfig.includePosts) {
   *       const posts = await new QueryBuilder<Post>('posts')
   *         .where('published', '=', true)
   *         .whereSearch(searchTerm, ['title', 'content', 'tags'])
   *         .limit(50)
   *         .all();
   *       
   *       results.push(...posts.map(post => ({
   *         type: 'post',
   *         id: post.id,
   *         title: post.title,
   *         description: post.content.substring(0, 200),
   *         relevance: this.calculateRelevance(post, searchTerm)
   *       })));
   *     }
   *     
   *     // Ordena por relevância
   *     return results.sort((a, b) => b.relevance - a.relevance);
   *   }
   * }
   */
  whereSearch(searchTerm: string, columns: (keyof T | string)[]): this { return this.whereRawSearch(searchTerm, columns as any); }

  /**
   * Adiciona uma operação UNION à query.
   * Combina resultados de duas queries, removendo duplicatas.
   * 
   * @param query - QueryBuilder a ser unido
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - UNION simples
   * const allUsers = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .union(
   *     new QueryBuilder<User>('archived_users')
   *       .select(['id', 'name', 'email'])
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - UNION com filtros
   * const activeUsers = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email', 'status'])
   *   .where('active', '=', true)
   *   .union(
   *     new QueryBuilder<User>('pending_users')
   *       .select(['id', 'name', 'email', 'status'])
   *       .where('verified', '=', true)
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios consolidados
   * class ConsolidatedReportSystem {
   *   static async generateConsolidatedReport(
   *     dateRange: DateRange,
   *     reportTypes: string[]
   *   ): Promise<ConsolidatedReport> {
   *     let baseQuery = new QueryBuilder<Report>('reports')
   *       .select(['date', 'type', 'value', 'source'])
   *       .whereBetween('date', [dateRange.start, dateRange.end]);
   *     
   *     // Adiciona UNIONs para diferentes fontes de dados
   *     if (reportTypes.includes('internal')) {
   *       baseQuery = baseQuery.union(
   *         new QueryBuilder<InternalReport>('internal_reports')
   *           .select(['date', 'type', 'value', 'source'])
   *           .whereBetween('date', [dateRange.start, dateRange.end])
   *       );
   *     }
   *     
   *     if (reportTypes.includes('external')) {
   *       baseQuery = baseQuery.union(
   *         new QueryBuilder<ExternalReport>('external_reports')
   *           .select(['date', 'type', 'value', 'source'])
   *           .whereBetween('date', [dateRange.start, dateRange.end])
   *       );
   *     }
   *     
   *     const results = await baseQuery
   *       .orderBy('date', 'ASC')
   *       .orderBy('type', 'ASC')
   *       .all();
   *     
   *     return {
   *       dateRange,
   *       reportTypes,
   *       totalRecords: results.length,
   *       data: results,
   *       summary: this.generateSummary(results)
   *     };
   *   }
   * }
   */
  union(query: QueryBuilder<any>): this { this.unionParts.push({ type: 'UNION', query }); return this; }
  /**
   * Adiciona uma operação UNION ALL à query.
   * Combina resultados de duas queries, mantendo duplicatas.
   * 
   * @param query - QueryBuilder a ser unido
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - UNION ALL simples
   * const allUsers = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .unionAll(
   *     new QueryBuilder<User>('archived_users')
   *       .select(['id', 'name', 'email'])
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - UNION ALL com filtros
   * const allActivities = await new QueryBuilder<Activity>('user_activities')
   *   .select(['user_id', 'activity_type', 'created_at'])
   *   .where('created_at', '>', new Date('2024-01-01'))
   *   .unionAll(
   *     new QueryBuilder<Activity>('system_activities')
   *       .select(['user_id', 'activity_type', 'created_at'])
   *       .where('created_at', '>', new Date('2024-01-01'))
   *   )
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de auditoria consolidada
   * class ConsolidatedAuditSystem {
   *   static async generateConsolidatedAudit(
   *     auditPeriod: DateRange,
   *     auditSources: string[]
   *   ): Promise<ConsolidatedAudit> {
   *     let baseQuery = new QueryBuilder<AuditLog>('audit_logs')
   *       .select(['timestamp', 'user_id', 'action', 'details', 'source'])
   *       .whereBetween('timestamp', [auditPeriod.start, auditPeriod.end]);
   *     
   *     // Adiciona UNION ALLs para diferentes fontes de auditoria
   *     if (auditSources.includes('database')) {
   *       baseQuery = baseQuery.unionAll(
   *         new QueryBuilder<DatabaseAudit>('database_audit_logs')
   *           .select(['timestamp', 'user_id', 'action', 'details', 'source'])
   *           .whereBetween('timestamp', [auditPeriod.start, auditPeriod.end])
   *       );
   *     }
   *     
   *     if (auditSources.includes('application')) {
   *       baseQuery = baseQuery.unionAll(
   *         new QueryBuilder<AppAudit>('application_audit_logs')
   *           .select(['timestamp', 'user_id', 'action', 'details', 'source'])
   *           .whereBetween('timestamp', [auditPeriod.start, auditPeriod.end])
   *       );
   *     }
   *     
   *     if (auditSources.includes('system')) {
   *       baseQuery = baseQuery.unionAll(
   *         new QueryBuilder<SystemAudit>('system_audit_logs')
   *           .select(['timestamp', 'user_id', 'action', 'details', 'source'])
   *           .whereBetween('timestamp', [auditPeriod.start, auditPeriod.end])
   *       );
   *     }
   *     
   *     const results = await baseQuery
   *       .orderBy('timestamp', 'ASC')
   *       .orderBy('user_id', 'ASC')
   *       .all();
   *     
   *     return {
   *       auditPeriod,
   *       auditSources,
   *       totalRecords: results.length,
   *       data: results,
   *       summary: this.generateAuditSummary(results),
   *       anomalies: this.detectAnomalies(results)
   *     };
   *   }
   * }
   */
  unionAll(query: QueryBuilder<any>): this { this.unionParts.push({ type: 'UNION ALL', query }); return this; }

  async make(): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const exec = getExecutorForTable(this.tableName, this.targetBanks) as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (!this.pendingAction) throw new Error('No pending write action to execute. Call insert(), update(), or delete() before .make()');
    const { type, data } = this.pendingAction;

    const mapAsyncResult = (raw: any): { changes: number; lastInsertRowid: number | bigint } => {
      if (Array.isArray(raw)) {
        const info = raw[1] || {};
        const changes = info.affectedRows ?? info.changes ?? 0;
        const lastId = info.insertId ?? info.lastInsertId ?? info.lastInsertRowid ?? 0;
        return { changes, lastInsertRowid: lastId };
      }
      const changes = raw?.affectedRows ?? raw?.changes ?? 0;
      const lastId = raw?.lastInsertId ?? raw?.lastInsertRowid ?? 0;
      return { changes, lastInsertRowid: lastId };
    };

    const qbHelper = <X = any>(t?: string) => new QueryBuilder<X>(t || this.tableName);

    switch (type) {
      case 'insert': {
        const obj = Array.isArray(data) ? data[0] : data;
        const columns = Object.keys(obj);
        const values = Object.values(obj);
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        eventManager.emit(`querykit:trigger:BEFORE:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'BEFORE', data: obj, where: undefined, qb: qbHelper } as any);
        const res = exec.runSync ? exec.runSync(sql, values) : await exec.executeQuery(sql, values);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'AFTER', data: obj, result: mapped, qb: qbHelper } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'update': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const setClauses = Object.keys(data).map(k => `${k} = ?`).join(', ');
        const params = Object.values(data);
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data, where: { sql: where, bindings: params }, qb: qbHelper } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data, where: { sql: where, bindings: params }, result: mapped, qb: qbHelper } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'delete': {
        if (this.whereClauses.length === 0) throw new Error('Delete operations must have a WHERE clause.');
        const params: any[] = [];
        const where = this.buildWhereClause(this.whereClauses, params, 'AND');
        const sql = `DELETE FROM ${this.tableName} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:DELETE:${this.tableName}`, { table: this.tableName, action: 'DELETE', timing: 'BEFORE', where: { sql: where, bindings: params }, qb: qbHelper } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:DELETE:${this.tableName}`, { table: this.tableName, action: 'DELETE', timing: 'AFTER', where: { sql: where, bindings: params }, result: mapped, qb: qbHelper } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'increment': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const { column, amount } = data as { column: string; amount: number };
        const params: any[] = [amount ?? 1];
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${column} = ${column} + ? WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: { column, amount }, where: { sql: where, bindings: params }, qb: qbHelper } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: { column, amount }, where: { sql: where, bindings: params }, result: mapped, qb: qbHelper } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'decrement': {
        if (this.whereClauses.length === 0) throw new Error('Update operations must have a WHERE clause.');
        const { column, amount } = data as { column: string; amount: number };
        const params: any[] = [amount ?? 1];
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sql = `UPDATE ${this.tableName} SET ${column} = ${column} - ? WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: { column, amount }, where: { sql: where, bindings: params }, qb: qbHelper } as any);
        const res = exec.runSync ? exec.runSync(sql, params) : await exec.executeQuery(sql, params);
        const mapped = exec.runSync ? res : mapAsyncResult(res);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: { column, amount }, where: { sql: where, bindings: params }, result: mapped, qb: qbHelper } as any);
        this.pendingAction = undefined;
        return mapped;
      }
      case 'updateOrInsert': {
        const { attributes, values } = data as { attributes: Record<string, any>; values: Record<string, any> };
        // Attempt update
        const setClauses = Object.keys(values).map(k => `${k} = ?`).join(', ');
        const params = Object.values(values);
        // Build where from attributes, ensuring params appended for where after values
        const whereClausesBackup = [...this.whereClauses];
        this.whereClauses = [];
        Object.entries(attributes).forEach(([k, v]) => this.where(k, '=', v));
        const where = this.buildWhereClause(this.whereClauses, params as any[], 'AND');
        const sqlUpd = `UPDATE ${this.tableName} SET ${setClauses} WHERE ${where}`;
        eventManager.emit(`querykit:trigger:BEFORE:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'BEFORE', data: values, where: { sql: where, bindings: params }, qb: qbHelper } as any);
        const resUpd = exec.runSync ? exec.runSync(sqlUpd, params) : await exec.executeQuery(sqlUpd, params);
        const mappedUpd = exec.runSync ? resUpd : mapAsyncResult(resUpd);
        eventManager.emit(`querykit:trigger:AFTER:UPDATE:${this.tableName}`, { table: this.tableName, action: 'UPDATE', timing: 'AFTER', data: values, where: { sql: where, bindings: params }, result: mappedUpd, qb: qbHelper } as any);
        let result = mappedUpd;
        if (!mappedUpd.changes) {
          // Perform insert with merged attributes+values
          const insertObj = { ...attributes, ...values };
          const columns = Object.keys(insertObj);
          const vals = Object.values(insertObj);
          const placeholders = columns.map(() => '?').join(', ');
          const sqlIns = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
          eventManager.emit(`querykit:trigger:BEFORE:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'BEFORE', data: insertObj, where: undefined, qb: qbHelper } as any);
          const resIns = exec.runSync ? exec.runSync(sqlIns, vals) : await exec.executeQuery(sqlIns, vals);
          const mappedIns = exec.runSync ? resIns : mapAsyncResult(resIns);
          eventManager.emit(`querykit:trigger:AFTER:INSERT:${this.tableName}`, { table: this.tableName, action: 'INSERT', timing: 'AFTER', data: insertObj, result: mappedIns, qb: qbHelper } as any);
          result = mappedIns;
        }
        // restore whereClauses
        this.whereClauses = whereClausesBackup;
        this.pendingAction = undefined;
        return result;
      }
      default:
        throw new Error(`Unsupported pending action: ${type}`);
    }
  }

  public relationship(selector?: RelationshipSelector<T>): this {
    this.includeAllRelations = selector || true
    return this
  }

  /**
   * Adiciona uma cláusula HAVING condicionalmente.
   * Aplica a cláusula HAVING apenas se a condição for verdadeira.
   * 
   * @param condition - Condição que determina se a cláusula HAVING será aplicada
   * @param column - Nome da coluna ou chave do tipo T para a cláusula HAVING
   * @param op - Operador de comparação
   * @param value - Valor para comparação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - HAVING condicional
   * const stats = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as user_count'])
   *   .groupBy('department')
   *   .havingIf(minUserCount > 10, 'user_count', '>', minUserCount)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos HAVING condicionais
   * const stats = await new QueryBuilder<Order>('orders')
   *   .select(['customer_id', 'COUNT(*) as order_count', 'SUM(total_amount) as total_spent'])
   *   .groupBy('customer_id')
   *   .havingIf(requireMinOrders, 'order_count', '>=', minOrders)
   *   .havingIf(requireMinSpending, 'total_spent', '>=', minSpending)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios dinâmicos
   * class DynamicReportSystem {
   *   static async generateDynamicReport(
   *     reportConfig: DynamicReportConfig,
   *     userPreferences: UserPreferences
   *   ): Promise<DynamicReport> {
   *     let query = new QueryBuilder<Transaction>('transactions')
   *       .select([
   *         'category',
   *         'COUNT(*) as transaction_count',
   *         'SUM(amount) as total_amount',
   *         'AVG(amount) as avg_amount'
   *       ])
   *       .groupBy('category');
   *     
   *     // Aplica filtros HAVING baseados na configuração
   *     if (reportConfig.minTransactionCount) {
   *       query = query.havingIf(true, 'transaction_count', '>=', reportConfig.minTransactionCount);
   *     }
   *     
   *     if (reportConfig.minTotalAmount) {
   *       query = query.havingIf(true, 'total_amount', '>=', reportConfig.minTotalAmount);
   *     }
   *     
   *     if (reportConfig.minAverageAmount) {
   *       query = query.havingIf(true, 'avg_amount', '>=', reportConfig.minAverageAmount);
   *     }
   *     
   *     // Filtros baseados nas preferências do usuário
   *     if (userPreferences.excludeLowVolumeCategories) {
   *       query = query.havingIf(true, 'transaction_count', '>', 5);
   *     }
   *     
   *     if (userPreferences.onlyHighValueCategories) {
   *       query = query.havingIf(true, 'avg_amount', '>', 100);
   *     }
   *     
   *     const results = await query
   *       .orderBy('total_amount', 'DESC')
   *       .all();
   *     
   *     return {
   *       reportConfig,
   *       userPreferences,
   *       totalCategories: results.length,
   *       data: results,
   *       summary: this.generateSummary(results)
   *     };
   *   }
   * }
   */
  havingIf(condition: any, column: keyof T | string, op: Operator, value: any): this { if (condition !== null && condition !== undefined && condition !== '') return this.having(column as any, op, value); return this; }

  /**
   * Adiciona uma cláusula WHERE para verificar se uma coluna JSON contém um valor específico.
   * Funcionalidade específica do PostgreSQL para operações com dados JSON.
   * 
   * @param column - Nome da coluna JSON para verificar
   * @param value - Valor que deve estar contido no JSON
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar se JSON contém valor
   * const usersWithTag = await new QueryBuilder<User>('users')
   *   .where('metadata', '=', '{"tags": ["admin", "moderator"]}')
   *   .whereJsonContains('metadata', '{"tags": ["admin"]}')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Filtro JSON com outras condições
   * const activeAdmins = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereJsonContains('permissions', '{"role": "admin"}')
   *   .where('last_login', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de filtros dinâmicos baseados em JSON
   * class DynamicFilterSystem {
   *   static async filterUsersByDynamicCriteria(
   *     filterCriteria: DynamicFilterCriteria,
   *     userPreferences: UserPreferences
   *   ): Promise<User[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'users.metadata',
   *         'users.preferences',
   *         'users.created_at',
   *         'profiles.avatar_url',
   *         'profiles.bio'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .where('users.active', '=', true);
   *     
   *     // Aplica filtros JSON condicionalmente baseados nos critérios
   *     if (filterCriteria.requiredTags && filterCriteria.requiredTags.length > 0) {
   *       filterCriteria.requiredTags.forEach(tag => {
   *         query = query.whereJsonContains('users.metadata', `{"tags": ["${tag}"]}`);
   *       });
   *     }
   *     
   *     if (filterCriteria.requiredPermissions && filterCriteria.requiredPermissions.length > 0) {
   *       filterCriteria.requiredPermissions.forEach(permission => {
   *         query = query.whereJsonContains('users.permissions', `{"permissions": ["${permission}"]}`);
   *       });
   *     }
   *     
   *     if (filterCriteria.requiredSkills && filterCriteria.requiredSkills.length > 0) {
   *       filterCriteria.requiredSkills.forEach(skill => {
   *         query = query.whereJsonContains('users.metadata', `{"skills": ["${skill}"]}`);
   *       });
   *     }
   *     
   *     // Filtros baseados nas preferências do usuário
   *     if (userPreferences.excludeInactive) {
   *       query = query.whereJsonContains('users.metadata', '{"status": "active"}');
   *     }
   *     
   *     if (userPreferences.onlyVerified) {
   *       query = query.whereJsonContains('users.metadata', '{"verified": true}');
   *     }
   *     
   *     // Ordenação baseada em critérios dinâmicos
   *     if (filterCriteria.sortBy === 'recent_activity') {
   *       query = query.orderBy('users.last_activity', 'DESC');
   *     } else if (filterCriteria.sortBy === 'reputation') {
   *       query = query.orderBy('users.reputation_score', 'DESC');
   *     } else {
   *       query = query.orderBy('users.created_at', 'DESC');
   *     }
   *     
   *     const result = await query.all();
   *     
   *     return result.map(user => ({
   *       id: user.id,
   *       name: user.name,
   *       email: user.email,
   *       metadata: JSON.parse(user.metadata),
   *       preferences: JSON.parse(user.preferences),
   *       createdAt: user.created_at,
   *       avatarUrl: user.avatar_url,
   *       bio: user.bio,
   *       tags: JSON.parse(user.metadata).tags || [],
   *       permissions: JSON.parse(user.metadata).permissions || [],
   *       skills: JSON.parse(user.metadata).skills || [],
   *       status: JSON.parse(user.metadata).status || 'unknown',
   *       verified: JSON.parse(user.metadata).verified || false
   *     }));
   *   }
   * }
   */
  whereJsonContains(column: keyof T | string, value: any): this {
    this.track('whereJsonContains', { column, value });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    
    if (executor?.dialect === 'postgres') {
      sql = `${String(column)} @> ?`; // PostgreSQL
    } else if (executor?.dialect === 'mysql') {
      sql = `JSON_CONTAINS(${String(column)}, ?)`; // MySQL
    } else if (executor?.dialect === 'oracle') {
      sql = `JSON_EXISTS(${String(column)}, '$')`; // Oracle
    } else if (executor?.dialect === 'mssql') {
      sql = `${String(column)} LIKE '%' + ? + '%'`; // SQL Server (fallback)
    } else {
      // Fallback universal - funciona em qualquer banco
      sql = `${String(column)} LIKE '%' + ? + '%'`;
    }
    
    this.whereClauses.push({ 
      type: 'raw', 
      sql, 
      logical: 'AND',
      value: value
    });
    return this;
  }

  /**
   * Adiciona uma cláusula WHERE para busca de texto completo (full-text search).
   * Funcionalidade específica do PostgreSQL para busca avançada em texto.
   * 
   * @param columns - Array de colunas para realizar a busca
   * @param query - Termo de busca para full-text search
   * @param language - Idioma para análise de texto (opcional, padrão: 'english')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca full-text simples
   * const searchResults = await new QueryBuilder<Post>('posts')
   *   .whereFullText(['title', 'content'], 'database optimization')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca com idioma específico
   * const portuguesePosts = await new QueryBuilder<Post>('posts')
   *   .whereFullText(['title', 'content'], 'otimização banco dados', 'portuguese')
   *   .where('language', '=', 'pt')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca inteligente com ranking
   * class IntelligentSearchSystem {
   *   static async searchContent(
   *     searchQuery: string,
   *     contentType: ContentType,
   *     searchOptions: SearchOptions
   *   ): Promise<SearchResult[]> {
   *     let query = new QueryBuilder<Content>('content')
   *       .select([
   *         'content.id',
   *         'content.title',
   *         'content.excerpt',
   *         'content.created_at',
   *         'content.updated_at',
   *         'content.author_id',
   *         'authors.name as author_name',
   *         'categories.name as category_name',
   *         'tags.name as tag_name',
   *         'ts_rank(to_tsvector(?, content.title || \' \' || content.body), plainto_tsquery(?)) as relevance_score'
   *       ])
   *       .leftJoin('authors', 'content.author_id = authors.id')
   *       .leftJoin('content_categories', 'content.id = content_categories.content_id')
   *       .leftJoin('categories', 'content_categories.category_id = categories.id')
   *       .leftJoin('content_tags', 'content.id = content_tags.content_id')
   *       .leftJoin('tags', 'content_tags.tag_id = tags.id')
   *       .where('content.status', '=', 'published')
   *       .where('content.type', '=', contentType)
   *       .whereFullText(['content.title', 'content.body'], searchQuery, searchOptions.language || 'english');
   *     
   *     // Aplica filtros adicionais baseados nas opções de busca
   *     if (searchOptions.authorFilter) {
   *       query = query.whereIn('content.author_id', searchOptions.authorFilter);
   *     }
   *     
   *     if (searchOptions.categoryFilter) {
   *       query = query.whereIn('categories.id', searchOptions.categoryFilter);
   *     }
   *     
   *     if (searchOptions.tagFilter) {
   *       query = query.whereIn('tags.id', searchOptions.tagFilter);
   *     }
   *     
   *     if (searchOptions.dateRange) {
   *       query = query.where('content.created_at', 'BETWEEN', [searchOptions.dateRange.start, searchOptions.dateRange.end]);
   *     }
   *     
   *     if (searchOptions.minRelevanceScore) {
   *       query = query.whereRaw('ts_rank(to_tsvector(?, content.title || \' \' || content.body), plainto_tsquery(?)) >= ?', 
   *         [searchOptions.language || 'english', searchQuery, searchOptions.minRelevanceScore]);
   *     }
   *     
   *     // Aplica ordenação por relevância
   *     query = query.orderBy('relevance_score', 'DESC');
   *     
   *     // Aplica paginação
   *     if (searchOptions.pagination) {
   *       query = query.paginate(searchOptions.pagination.page, searchOptions.pagination.perPage);
   *     }
   *     
   *     const results = await query.all();
   *     
   *     return results.map(result => ({
   *       id: result.id,
   *       title: result.title,
   *       excerpt: result.excerpt,
   *       createdAt: result.created_at,
   *       updatedAt: result.updated_at,
   *       author: {
   *         id: result.author_id,
   *         name: result.author_name
   *       },
   *       category: result.category_name,
   *       tags: result.tag_name ? [result.tag_name] : [],
   *       relevanceScore: result.relevance_score,
   *       url: this.generateContentUrl(result),
   *       searchHighlights: this.generateSearchHighlights(result, searchQuery)
   *     }));
   *   }
   *   
   *   private static generateContentUrl(content: any): string {
   *     return `/content/${content.id}/${content.title.toLowerCase().replace(/\s+/g, '-')}`;
   *   }
   *   
   *   private static generateSearchHighlights(content: any, searchQuery: string): string[] {
   *     const highlights: string[] = [];
   *     const queryTerms = searchQuery.toLowerCase().split(/\s+/);
   *     
   *     // Gera highlights para título
   *     queryTerms.forEach(term => {
   *       if (content.title.toLowerCase().includes(term)) {
   *         highlights.push(`<strong>${term}</strong> encontrado no título`);
   *       }
   *     });
   *     
   *     // Gera highlights para conteúdo
   *     queryTerms.forEach(term => {
   *       if (content.excerpt.toLowerCase().includes(term)) {
   *         highlights.push(`<strong>${term}</strong> encontrado no resumo`);
   *       }
   *     });
   *     
   *     return highlights;
   *   }
   * }
   */
  whereFullText(columns: (keyof T | string)[], query: string, language: string = 'english'): this {
    this.track('whereFullText', { columns, query, language });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    let values: any[];
    
    if (executor?.dialect === 'postgres') {
      // PostgreSQL - full-text search nativo
      const columnList = columns.map(c => String(c)).join(' || \' \' || ');
      sql = `to_tsvector(?, ${columnList}) @@ plainto_tsquery(?)`;
      values = [language, query];
    } else if (executor?.dialect === 'mysql') {
      // MySQL - MATCH AGAINST
      const columnList = columns.map(c => String(c)).join(', ');
      sql = `MATCH(${columnList}) AGAINST(? IN NATURAL LANGUAGE MODE)`;
      values = [query];
    } else if (executor?.dialect === 'oracle') {
      // Oracle - CONTAINS
      const columnList = columns.map(c => `CONTAINS(${String(c)}, ?) > 0`).join(' OR ');
      sql = `(${columnList})`;
      values = Array(columns.length).fill(query);
    } else if (executor?.dialect === 'mssql') {
      // SQL Server - CONTAINS
      const columnList = columns.map(c => `CONTAINS(${String(c)}, ?)`).join(' OR ');
      sql = `(${columnList})`;
      values = Array(columns.length).fill(query);
    } else {
      // Fallback universal - LIKE em todas as colunas
      const columnList = columns.map(c => `${String(c)} LIKE ?`).join(' OR ');
      sql = `(${columnList})`;
      values = Array(columns.length).fill(`%${query}%`);
    }
    
    this.whereClauses.push({ 
      type: 'raw', 
      sql, 
      logical: 'AND',
      value: values
    });
    return this;
  }

  /**
   * Adiciona uma cláusula WHERE para verificar se uma coluna array contém um valor específico.
   * Funcionalidade específica do PostgreSQL para operações com arrays.
   * 
   * @param column - Nome da coluna array para verificar
   * @param value - Valor que deve estar contido no array
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar se array contém valor
   * const usersWithSkill = await new QueryBuilder<User>('users')
   *   .whereArrayContains('skills', 'JavaScript')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Filtro array com outras condições
   * const activeDevelopers = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereArrayContains('skills', 'Python')
   *   .whereArrayContains('languages', 'English')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca por habilidades e competências
   * class SkillMatchingSystem {
   *   static async findUsersBySkills(
   *     requiredSkills: string[],
   *     preferredSkills: string[],
   *     locationFilter?: string,
   *     experienceLevel?: string
   *   ): Promise<SkillMatchResult[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'users.skills',
   *         'users.languages',
   *         'users.experience_level',
   *         'users.location',
   *         'users.availability',
   *         'profiles.bio',
   *         'profiles.hourly_rate',
   *         'profiles.rating',
   *         'profiles.completed_projects'
   *       ])
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .where('users.active', '=', true)
   *       .where('users.verified', '=', true);
   *     
   *     // Aplica filtros obrigatórios de habilidades
   *     requiredSkills.forEach(skill => {
   *       query = query.whereArrayContains('users.skills', skill);
   *     });
   *     
   *     // Aplica filtros de localização se especificado
   *     if (locationFilter) {
   *       query = query.where('users.location', 'ILIKE', `%${locationFilter}%`);
   *     }
   *     
   *     // Aplica filtros de nível de experiência se especificado
   *     if (experienceLevel) {
   *       query = query.where('users.experience_level', '=', experienceLevel);
   *     }
   *     
   *     // Aplica ordenação por relevância (habilidades preferidas)
   *     if (preferredSkills.length > 0) {
   *       const preferredSkillsCase = preferredSkills.map(skill => 
   *         `CASE WHEN '${skill}' = ANY(users.skills) THEN 1 ELSE 0 END`
   *       ).join(' + ');
   *       
   *       query = query.selectExpression(`(${preferredSkillsCase}) as skill_match_score`);
   *       query = query.orderBy('skill_match_score', 'DESC');
   *     }
   *     
   *     // Aplica ordenação secundária por rating
   *     query = query.orderBy('profiles.rating', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     return results.map(user => ({
   *       id: user.id,
   *       name: user.name,
   *       email: user.email,
   *       skills: user.skills || [],
   *       languages: user.languages || [],
   *       experienceLevel: user.experience_level,
   *       location: user.location,
   *       availability: user.availability,
   *       bio: user.bio,
   *       hourlyRate: user.hourly_rate,
   *       rating: user.rating,
   *       completedProjects: user.completed_projects,
   *       skillMatchScore: user.skill_match_score || 0,
   *       requiredSkillsMatch: requiredSkills.every(skill => user.skills?.includes(skill)),
   *       preferredSkillsMatch: preferredSkills.filter(skill => user.skills?.includes(skill)).length,
   *       matchPercentage: this.calculateMatchPercentage(user, requiredSkills, preferredSkills)
   *     }));
   *   }
   *   
   *   private static calculateMatchPercentage(
   *     user: any, 
   *     requiredSkills: string[], 
   *     preferredSkills: string[]
   *   ): number {
   *     const requiredMatch = requiredSkills.every(skill => user.skills?.includes(skill)) ? 1 : 0;
   *     const preferredMatch = preferredSkills.filter(skill => user.skills?.includes(skill)).length / preferredSkills.length;
   *     
   *     // Peso: 70% para habilidades obrigatórias, 30% para preferidas
   *     return (requiredMatch * 0.7) + (preferredMatch * 0.3);
   *   }
   * }
   */
  whereArrayContains(column: keyof T | string, value: any): this {
    this.track('whereArrayContains', { column, value });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    
    if (executor?.dialect === 'postgres') {
      // PostgreSQL - operador ANY
      sql = `? = ANY(${String(column)})`;
    } else if (executor?.dialect === 'mysql') {
      // MySQL - FIND_IN_SET para campos SET, JSON_CONTAINS para JSON
      sql = `FIND_IN_SET(?, ${String(column)}) > 0`;
    } else if (executor?.dialect === 'oracle') {
      // Oracle - operador IN com subquery
      sql = `? IN (SELECT COLUMN_VALUE FROM TABLE(SYS.ODCIVARCHAR2LIST(${String(column)})))`;
    } else if (executor?.dialect === 'mssql') {
      // SQL Server - STRING_SPLIT para campos separados por vírgula
      sql = `? IN (SELECT value FROM STRING_SPLIT(${String(column)}, ','))`;
    } else {
      // Fallback universal - LIKE para campos de texto
      sql = `${String(column)} LIKE ?`;
    }
    
    this.whereClauses.push({ 
      type: 'raw', 
      sql, 
      logical: 'AND',
      value: value
    });
    return this;
  }

  /**
   * Adiciona uma cláusula WHERE usando FIND_IN_SET para buscar valores em campos SET do MySQL.
   * Funcionalidade específica do MySQL para operações com campos SET.
   * 
   * @param column - Nome da coluna SET para verificar
   * @param value - Valor que deve estar presente no SET
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Verificar se SET contém valor
   * const usersWithRole = await new QueryBuilder<User>('users')
   *   .whereFindInSet('roles', 'admin')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplos filtros SET
   * const activeAdmins = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereFindInSet('roles', 'admin')
   *   .whereFindInSet('permissions', 'read')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de controle de acesso baseado em SETs
   * class AccessControlSystem {
   *   static async findUsersByAccessLevel(
   *     requiredRoles: string[],
   *     requiredPermissions: string[],
   *     departmentFilter?: string,
   *     locationFilter?: string
   *   ): Promise<AccessControlResult[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'users.roles',
   *         'users.permissions',
   *         'users.department_id',
   *         'users.location_id',
   *         'users.last_login',
   *         'users.status',
   *         'departments.name as department_name',
   *         'locations.name as location_name',
   *         'locations.country',
   *         'profiles.phone',
   *         'profiles.emergency_contact'
   *       ])
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('locations', 'users.location_id = locations.id')
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .where('users.active', '=', true)
   *       .where('users.status', '=', 'active');
   *     
   *     // Aplica filtros de roles obrigatórios
   *     requiredRoles.forEach(role => {
   *       query = query.whereFindInSet('users.roles', role);
   *     });
   *     
   *     // Aplica filtros de permissões obrigatórias
   *     requiredPermissions.forEach(permission => {
   *       query = query.whereFindInSet('users.permissions', permission);
   *     });
   *     
   *     // Aplica filtros adicionais se especificados
   *     if (departmentFilter) {
   *       query = query.where('departments.name', '=', departmentFilter);
   *     }
   *     
   *     if (locationFilter) {
   *       query = query.where('locations.name', '=', locationFilter);
   *     }
   *     
   *     // Aplica ordenação por último login
   *     query = query.orderBy('users.last_login', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     return results.map(user => ({
   *       id: user.id,
   *       name: user.name,
   *       email: user.email,
   *       roles: user.roles ? user.roles.split(',') : [],
   *       permissions: user.permissions ? user.permissions.split(',') : [],
   *       department: {
   *         id: user.department_id,
   *         name: user.department_name
   *       },
   *       location: {
   *         id: user.location_id,
   *         name: user.location_name,
   *         country: user.country
   *       },
   *       lastLogin: user.last_login,
   *       status: user.status,
   *       profile: {
   *         phone: user.phone,
   *         emergencyContact: user.emergency_contact
   *       },
   *       accessLevel: this.calculateAccessLevel(user.roles, user.permissions),
   *       hasRequiredAccess: this.validateAccess(user.roles, user.permissions, requiredRoles, requiredPermissions)
   *     }));
   *   }
   *   
   *   private static calculateAccessLevel(roles: string, permissions: string): string {
   *     const roleList = roles ? roles.split(',') : [];
   *     const permissionList = permissions ? permissions.split(',') : [];
   *     
   *     if (roleList.includes('super_admin')) return 'SUPER_ADMIN';
   *     if (roleList.includes('admin')) return 'ADMIN';
   *     if (roleList.includes('manager')) return 'MANAGER';
   *     if (roleList.includes('user')) return 'USER';
   *     if (roleList.includes('guest')) return 'GUEST';
   *     
   *     return 'UNKNOWN';
   *   }
   *   
   *   private static validateAccess(
   *     userRoles: string, 
   *     userPermissions: string, 
   *     requiredRoles: string[], 
   *     requiredPermissions: string[]
   *   ): boolean {
   *     const userRoleList = userRoles ? userRoles.split(',') : [];
   *     const userPermissionList = userPermissions ? userPermissions.split(',') : [];
   *     
   *     const hasRequiredRoles = requiredRoles.every(role => userRoleList.includes(role));
   *     const hasRequiredPermissions = requiredPermissions.every(permission => userPermissionList.includes(permission));
   *     
   *     return hasRequiredRoles && hasRequiredPermissions;
   *   }
   * }
   */
  whereFindInSet(column: keyof T | string, value: any): this {
    this.track('whereFindInSet', { column, value });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    
    if (executor?.dialect === 'mysql') {
      // MySQL - FIND_IN_SET para campos SET
      sql = `FIND_IN_SET(?, ${String(column)}) > 0`;
    } else if (executor?.dialect === 'postgres') {
      // PostgreSQL - operador ANY com array
      sql = `? = ANY(string_to_array(${String(column)}, ','))`;
    } else if (executor?.dialect === 'oracle') {
      // Oracle - operador IN com subquery
      sql = `? IN (SELECT COLUMN_VALUE FROM TABLE(SYS.ODCIVARCHAR2LIST(${String(column)})))`;
    } else if (executor?.dialect === 'mssql') {
      // SQL Server - STRING_SPLIT para campos separados por vírgula
      sql = `? IN (SELECT value FROM STRING_SPLIT(${String(column)}, ','))`;
    } else {
      // Fallback universal - LIKE para campos de texto
      sql = `${String(column)} LIKE ?`;
    }
    
    this.whereClauses.push({ 
      type: 'raw', 
      sql, 
      logical: 'AND',
      value: value
    });
    return this;
  }

  /**
   * Adiciona uma função ROW_NUMBER() à seleção para numerar linhas sequencialmente.
   * Funcionalidade específica do SQL Server e outros bancos que suportam window functions.
   * 
   * @param alias - Alias para a coluna ROW_NUMBER (padrão: 'row_number')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Adicionar numeração de linhas
   * const numberedUsers = await new QueryBuilder<User>('users')
   *   .selectRowNumber('row_num')
   *   .orderBy('name', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Numeração com filtros
   * const activeNumberedUsers = await new QueryBuilder<User>('users')
   *   .select(['id', 'name', 'email'])
   *   .selectRowNumber('position')
   *   .where('active', '=', true)
   *   .orderBy('created_at', 'DESC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de ranking e paginação inteligente
   * class RankingSystem {
   *   static async generateUserRankings(
   *     rankingCriteria: RankingCriteria,
   *     paginationConfig: PaginationConfig
   *   ): Promise<UserRankingResult[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.id',
   *         'users.name',
   *         'users.email',
   *         'users.department_id',
   *         'departments.name as department_name',
   *         'profiles.avatar_url',
   *         'profiles.bio',
   *         'performance.total_score',
   *         'performance.quality_score',
   *         'performance.efficiency_score',
   *         'performance.collaboration_score',
   *         'engagement.satisfaction_score',
   *         'engagement.hours_worked',
   *         'engagement.projects_completed'
   *       ])
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('performance', 'users.id = performance.user_id')
   *       .leftJoin('engagement', 'users.id = engagement.user_id')
   *       .where('users.active', '=', true)
   *       .where('performance.evaluation_period', '=', rankingCriteria.period);
   *     
   *     // Aplica filtros de departamento se especificado
   *     if (rankingCriteria.departmentFilter) {
   *       query = query.whereIn('users.department_id', rankingCriteria.departmentFilter);
   *     }
   *     
   *     // Aplica filtros de performance se especificado
   *     if (rankingCriteria.minPerformanceScore) {
   *       query = query.where('performance.total_score', '>=', rankingCriteria.minPerformanceScore);
   *     }
   *     
   *     // Aplica filtros de engajamento se especificado
   *     if (rankingCriteria.minEngagementScore) {
   *       query = query.where('engagement.satisfaction_score', '>=', rankingCriteria.minEngagementScore);
   *     }
   *     
   *     // Aplica ordenação baseada nos critérios de ranking
   *     switch (rankingCriteria.sortBy) {
   *       case 'total_score':
   *         query = query.orderBy('performance.total_score', 'DESC');
   *         break;
   *       case 'quality_score':
   *         query = query.orderBy('performance.quality_score', 'DESC');
   *         break;
   *       case 'efficiency_score':
   *         query = query.orderBy('performance.efficiency_score', 'DESC');
   *         break;
   *       case 'collaboration_score':
   *         query = query.orderBy('performance.collaboration_score', 'DESC');
   *         break;
   *       case 'satisfaction_score':
   *         query = query.orderBy('engagement.satisfaction_score', 'DESC');
   *         break;
   *       case 'projects_completed':
   *         query = query.orderBy('engagement.projects_completed', 'DESC');
   *         break;
   *       default:
   *         query = query.orderBy('performance.total_score', 'DESC');
   *     }
   *     
   *     // Adiciona numeração de linha para ranking
   *     query = query.selectRowNumber('ranking_position');
   *     
   *     // Aplica paginação
   *     query = query.paginate(paginationConfig.page, paginationConfig.perPage);
   *     
   *     const results = await query.all();
   *     
   *     return results.map((user, index) => ({
   *       rankingPosition: user.ranking_position,
   *       id: user.id,
   *       name: user.name,
   *       email: user.email,
   *       department: {
   *         id: user.department_id,
   *         name: user.department_name
   *       },
   *       profile: {
   *         avatarUrl: user.avatar_url,
   *         bio: user.bio
   *       },
   *       performance: {
   *         totalScore: user.total_score,
   *         qualityScore: user.quality_score,
   *         efficiencyScore: user.efficiency_score,
   *         collaborationScore: user.collaboration_score
   *       },
   *       engagement: {
   *         satisfactionScore: user.satisfaction_score,
   *         hoursWorked: user.hours_worked,
   *         projectsCompleted: user.projects_completed
   *       },
   *       ranking: {
   *         position: user.ranking_position,
   *         percentile: this.calculatePercentile(user.ranking_position, results.length),
   *         tier: this.calculateTier(user.ranking_position, results.length),
   *         trend: this.calculateTrend(user, rankingCriteria.previousPeriod)
   *       }
   *     }));
   *   }
   *   
   *   private static calculatePercentile(position: number, total: number): number {
   *     return Math.round(((total - position + 1) / total) * 100);
   *   }
   *   
   *   private static calculateTier(position: number, total: number): string {
   *     const percentile = this.calculatePercentile(position, total);
   *     
   *     if (percentile >= 90) return 'DIAMOND';
   *     if (percentile >= 80) return 'PLATINUM';
   *     if (percentile >= 70) return 'GOLD';
   *     if (percentile >= 50) return 'SILVER';
   *     if (percentile >= 25) return 'BRONZE';
   *     return 'IRON';
   *   }
   *   
   *   private static calculateTrend(user: any, previousPeriod: string): string {
   *     // Implementação para calcular tendência baseada no período anterior
   *     return 'STABLE'; // Placeholder
   *   }
   * }
   */
  selectRowNumber(alias: string = 'row_number'): this {
    this.track('selectRowNumber', { alias });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    
    if (executor?.dialect === 'postgres' || executor?.dialect === 'mssql' || executor?.dialect === 'oracle') {
      // PostgreSQL, SQL Server, Oracle - ROW_NUMBER() OVER()
      const orderBy = this.orderClauses.length > 0 
        ? this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ') 
        : '1';
      sql = `ROW_NUMBER() OVER (ORDER BY ${orderBy}) as ${alias}`;
    } else if (executor?.dialect === 'mysql') {
      // MySQL - ROW_NUMBER() OVER() (MySQL 8.0+)
      const orderBy = this.orderClauses.length > 0 
        ? this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ') 
        : '1';
      sql = `ROW_NUMBER() OVER (ORDER BY ${orderBy}) as ${alias}`;
    } else {
      // Fallback universal - subquery com LIMIT
      const orderBy = this.orderClauses.length > 0 
        ? this.orderClauses.map(o => `${o.column} ${o.direction}`).join(', ') 
        : '1';
      sql = `(SELECT COUNT(*) + 1 FROM ${this.tableName} t2 WHERE t2.${orderBy.split(' ')[0]} < ${this.tableName}.${orderBy.split(' ')[0]}) as ${alias}`;
    }
    
    this.selectColumns.push(raw(sql));
    return this;
  }

  /**
   * Adiciona uma cláusula WHERE para filtrar por data específica (ignorando hora).
   * Funciona com diferentes tipos de bancos de dados.
   * 
   * @param column - Nome da coluna de data para filtrar
   * @param date - Data para comparação (será convertida para início do dia)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Filtrar por data específica
   * const todayUsers = await new QueryBuilder<User>('users')
   *   .whereDate('created_at', new Date())
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Filtro de data com outras condições
   * const activeUsersToday = await new QueryBuilder<User>('users')
   *   .where('active', '=', true)
   *   .whereDate('last_login', new Date())
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios por data com agregações
   * class DateBasedReportingSystem {
   *   static async generateDailyReport(
   *     reportDate: Date,
   *     reportType: ReportType,
   *     filters: ReportFilters
   *   ): Promise<DailyReportResult> {
   *     let query = new QueryBuilder<Activity>('user_activities')
   *       .select([
   *         'user_activities.user_id',
   *         'users.name as user_name',
   *         'users.email as user_email',
   *         'departments.name as department_name',
   *         'activity_types.name as activity_type',
   *         'activity_types.category as activity_category',
   *         'COUNT(user_activities.id) as activity_count',
   *         'SUM(user_activities.duration_minutes) as total_duration',
   *         'AVG(user_activities.duration_minutes) as avg_duration',
   *         'MAX(user_activities.created_at) as last_activity',
   *         'MIN(user_activities.created_at) as first_activity'
   *       ])
   *       .leftJoin('users', 'user_activities.user_id = users.id')
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('activity_types', 'user_activities.activity_type_id = activity_types.id')
   *       .whereDate('user_activities.created_at', reportDate)
   *       .where('user_activities.status', '=', 'completed');
   *     
   *     // Aplica filtros baseados no tipo de relatório
   *     if (reportType === 'department') {
   *       query = query.groupBy('users.department_id', 'activity_types.id');
   *     } else if (reportType === 'user') {
   *       query = query.groupBy('user_activities.user_id', 'activity_types.id');
   *     } else if (reportType === 'activity') {
   *       query = query.groupBy('activity_types.id');
   *     }
   *     
   *     // Aplica filtros adicionais
   *     if (filters.departmentFilter) {
   *       query = query.whereIn('users.department_id', filters.departmentFilter);
   *     }
   *     
   *     if (filters.activityTypeFilter) {
   *       query = query.whereIn('activity_types.id', filters.activityTypeFilter);
   *     }
   *     
   *     if (filters.minDuration) {
   *       query = query.where('user_activities.duration_minutes', '>=', filters.minDuration);
   *     }
   *     
   *     // Aplica ordenação
   *     query = query.orderBy('activity_count', 'DESC');
   *     
   *     const results = await query.all();
   *     
   *     // Calcula métricas agregadas
   *     const totalActivities = results.reduce((sum, r) => sum + r.activity_count, 0);
   *     const totalDuration = results.reduce((sum, r) => sum + r.total_duration, 0);
   *     const uniqueUsers = new Set(results.map(r => r.user_id)).size;
   *     const uniqueDepartments = new Set(results.map(r => r.department_name)).size;
   *     
   *     return {
   *       reportId: `daily_${reportDate.toISOString().split('T')[0]}_${reportType}`,
   *       generatedAt: new Date(),
   *       reportDate,
   *       reportType,
   *       filters,
   *       summary: {
   *         totalActivities,
   *         totalDuration,
   *         averageDuration: totalDuration / totalActivities,
   *         uniqueUsers,
   *         uniqueDepartments,
   *         averageActivitiesPerUser: totalActivities / uniqueUsers
   *       },
   *       breakdown: results.map(row => ({
   *         userId: row.user_id,
   *         userName: row.user_name,
   *         userEmail: row.user_email,
   *         departmentName: row.department_name,
   *         activityType: row.activity_type,
   *         activityCategory: row.activity_category,
   *         metrics: {
   *           activityCount: row.activity_count,
   *           totalDuration: row.total_duration,
   *           averageDuration: row.avg_duration,
   *           lastActivity: row.last_activity,
   *           firstActivity: row.first_activity
   *         }
   *       })),
   *       insights: this.generateInsights(results, reportType),
   *       recommendations: this.generateRecommendations(results, reportType)
   *     };
   *   }
   *   
   *   private static generateInsights(results: any[], reportType: ReportType): string[] {
   *     const insights: string[] = [];
   *     
   *     if (reportType === 'department') {
   *       const topDepartment = results.reduce((max, r) => r.activity_count > max.activity_count ? r : max);
   *       insights.push(`${topDepartment.department_name} teve a maior atividade com ${topDepartment.activity_count} atividades`);
   *     }
   *     
   *     return insights;
   *   }
   *   
   *   private static generateRecommendations(results: any[], reportType: ReportType): string[] {
   *     const recommendations: string[] = [];
   *     
   *     if (results.length === 0) {
   *       recommendations.push('Nenhuma atividade registrada para esta data');
   *     }
   *     
   *     return recommendations;
   *   }
   * }
   */
  whereDate(column: keyof T | string, date: Date): this {
    this.track('whereDate', { column, date });
    
    // Detecta o executor para usar a sintaxe correta do banco
    const executor = getExecutorForTable(this.tableName, this.targetBanks);
    let sql: string;
    let values: any[];
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    if (executor?.dialect === 'postgres') {
      // PostgreSQL - DATE() função para extrair apenas a data
      sql = `DATE(${String(column)}) = DATE(?)`;
      values = [date];
    } else if (executor?.dialect === 'mysql') {
      // MySQL - DATE() função para extrair apenas a data
      sql = `DATE(${String(column)}) = DATE(?)`;
      values = [date];
    } else if (executor?.dialect === 'oracle') {
      // Oracle - TRUNC() para truncar para início do dia
      sql = `TRUNC(${String(column)}) = TRUNC(?)`;
      values = [date];
    } else if (executor?.dialect === 'mssql') {
      // SQL Server - CAST para DATE
      sql = `CAST(${String(column)} AS DATE) = CAST(? AS DATE)`;
      values = [date];
    } else {
      // Fallback universal - BETWEEN com início e fim do dia
      sql = `${String(column)} BETWEEN ? AND ?`;
      values = [startOfDay, endOfDay];
    }
    
    this.whereClauses.push({ 
      type: 'raw', 
      sql, 
      logical: 'AND',
      value: values
    });
    return this;
  }

  /**
   * Adiciona uma cláusula GROUP BY para agrupar resultados.
   * Útil para consultas de agregação e relatórios.
   * 
   * @param columns - Array de colunas para agrupamento
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - GROUP BY simples
   * const userStats = await new QueryBuilder<User>('users')
   *   .select(['role', 'COUNT(*) as count'])
   *   .groupBy('role')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas colunas de agrupamento
   * const departmentStats = await new QueryBuilder<User>('users')
   *   .select(['department', 'role', 'COUNT(*) as count', 'AVG(salary) as avg_salary'])
   *   .groupBy('department', 'role')
   *   .orderBy('department', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de relatórios agregados
   * class AggregatedReportingSystem {
   *   static async generateComprehensiveReport(
   *     reportConfig: ReportConfig,
   *     dateRange: DateRange
   *   ): Promise<ComprehensiveReport> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.department_id',
   *         'departments.name as department_name',
   *         'users.role',
   *         'COUNT(DISTINCT users.id) as total_users',
   *         'COUNT(DISTINCT CASE WHEN users.active = 1 THEN users.id END) as active_users',
   *         'COUNT(DISTINCT CASE WHEN users.verified = 1 THEN users.id END) as verified_users',
   *         'AVG(profiles.experience_years) as avg_experience',
   *         'SUM(CASE WHEN users.last_login > ? THEN 1 ELSE 0 END) as recent_logins',
   *         'AVG(engagement_scores.score) as avg_engagement',
   *         'MAX(users.created_at) as newest_user_date',
   *         'MIN(users.created_at) as oldest_user_date'
   *       ])
   *       .leftJoin('departments', 'users.department_id = departments.id')
   *       .leftJoin('profiles', 'users.id = profiles.user_id')
   *       .leftJoin('engagement_scores', 'users.id = engagement_scores.user_id AND engagement_scores.period = ?')
   *       .where('users.created_at', 'BETWEEN', [dateRange.start, dateRange.end])
   *       .groupBy('users.department_id', 'users.role')
   *       .orderBy('departments.name', 'ASC')
   *       .orderBy('users.role', 'ASC');
   *     
   *     const result = await query.all();
   *     
   *     return {
   *       summary: {
   *         totalDepartments: new Set(result.map(r => r.department_id)).size,
   *         totalRoles: new Set(result.map(r => r.role)).size,
   *         totalUsers: result.reduce((sum, r) => sum + r.total_users, 0),
   *         activeUsers: result.reduce((sum, r) => sum + r.active_users, 0),
   *         verifiedUsers: result.reduce((sum, r) => sum + r.verified_users, 0)
   *       },
   *       departmentBreakdown: result.map(row => ({
   *         departmentId: row.department_id,
   *         departmentName: row.department_name,
   *         role: row.role,
   *         totalUsers: row.total_users,
   *         activeUsers: row.active_users,
   *         verifiedUsers: row.verified_users,
   *         averageExperience: row.avg_experience,
   *         recentLogins: row.recent_logins,
   *         averageEngagement: row.avg_engagement,
   *         newestUserDate: row.newest_user_date,
   *         oldestUserDate: row.oldest_user_date
   *       }))
   *     };
   *   }
   * }
   */
  groupBy(columns: (keyof T | string)[]): this { this.groupByColumns = columns.map(c => String(c)); return this; }
  
  /**
   * Adiciona uma cláusula HAVING para filtrar resultados de agregação.
   * Funciona como WHERE, mas para colunas agregadas e grupos.
   * 
   * @param column - Nome da coluna ou expressão agregada para filtrar
   * @param op - Operador de comparação SQL
   * @param value - Valor para comparação
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - HAVING simples
   * const activeDepartments = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as count'])
   *   .groupBy('department')
   *   .having('count', '>', 10)
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Múltiplas condições HAVING
   * const highPerformingDepartments = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as count', 'AVG(salary) as avg_salary'])
   *   .groupBy('department')
   *   .having('count', '>', 5)
   *   .having('avg_salary', '>', 50000)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise de performance com filtros complexos
   * class PerformanceAnalysisSystem {
   *   static async analyzeHighPerformingTeams(
   *     performanceCriteria: PerformanceCriteria,
   *     analysisPeriod: DateRange
   *   ): Promise<TeamPerformanceReport[]> {
   *     let query = new QueryBuilder<User>('users')
   *       .select([
   *         'users.team_id',
   *         'teams.name as team_name',
   *         'teams.manager_id',
   *         'managers.name as manager_name',
   *         'COUNT(DISTINCT users.id) as team_size',
   *         'COUNT(DISTINCT CASE WHEN users.active = 1 THEN users.id END) as active_members',
   *         'AVG(performance_metrics.productivity_score) as avg_productivity',
   *         'AVG(performance_metrics.quality_score) as avg_quality',
   *         'AVG(performance_metrics.collaboration_score) as avg_collaboration',
   *         'SUM(performance_metrics.completed_tasks) as total_completed_tasks',
   *         'AVG(performance_metrics.response_time) as avg_response_time',
   *         'COUNT(DISTINCT CASE WHEN performance_metrics.achievement_level = "excellent" THEN users.id END) as excellent_performers',
   *         'COUNT(DISTINCT CASE WHEN performance_metrics.achievement_level = "poor" THEN users.id END) as poor_performers'
   *       ])
   *       .leftJoin('teams', 'users.team_id = teams.id')
   *       .leftJoin('users as managers', 'teams.manager_id = managers.id')
   *       .leftJoin('performance_metrics', 'users.id = performance_metrics.user_id AND performance_metrics.period = ?')
   *       .where('users.active', '=', true)
   *       .where('performance_metrics.evaluation_date', 'BETWEEN', [analysisPeriod.start, analysisPeriod.end])
   *       .groupBy('users.team_id')
   *       .having('team_size', '>=', performanceCriteria.minTeamSize)
   *       .having('avg_productivity', '>=', performanceCriteria.minProductivityScore)
   *       .having('avg_quality', '>=', performanceCriteria.minQualityScore)
   *       .having('avg_collaboration', '>=', performanceCriteria.minCollaborationScore)
   *       .having('excellent_performers', '>=', performanceCriteria.minExcellentPerformers)
   *       .having('poor_performers', '<=', performanceCriteria.maxPoorPerformers)
   *       .orderBy('avg_productivity', 'DESC')
   *       .orderBy('avg_quality', 'DESC');
   *     
   *     const result = await query.all();
   *     
   *     return result.map(row => ({
   *       teamId: row.team_id,
   *       teamName: row.team_name,
   *       managerId: row.manager_id,
   *       managerName: row.manager_name,
   *       teamSize: row.team_size,
   *       activeMembers: row.active_members,
   *       averageProductivity: row.avg_productivity,
   *       averageQuality: row.avg_quality,
   *       averageCollaboration: row.avg_collaboration,
   *       totalCompletedTasks: row.total_completed_tasks,
   *       averageResponseTime: row.avg_response_time,
   *       excellentPerformers: row.excellent_performers,
   *       poorPerformers: row.poor_performers,
   *       overallScore: this.calculateOverallScore(row),
   *       performanceLevel: this.getPerformanceLevel(row),
   *       recommendations: this.generateTeamRecommendations(row)
   *     }));
   *   }
   *   
   *   private static calculateOverallScore(team: any): number {
   *     const weights = {
   *       productivity: 0.3,
   *       quality: 0.3,
   *       collaboration: 0.2,
   *       responseTime: 0.1,
   *       taskCompletion: 0.1
   *     };
   *     
   *     return (
   *       (team.avg_productivity * weights.productivity) +
   *       (team.avg_quality * weights.quality) +
   *       (team.avg_collaboration * weights.collaboration) +
   *       ((100 - team.avg_response_time) * weights.responseTime) +
   *       (Math.min(team.total_completed_tasks / 100, 1) * 100 * weights.taskCompletion)
   *     );
   *   }
   * }
   */
  having(column: keyof T | string, op: Operator, value: any): this { this.havingClauses.push({ type: 'basic', column, operator: op, value, logical: 'AND' }); return this; }
  
  /**
   * Adiciona uma cláusula HAVING com SQL raw customizado.
   * Permite expressões SQL complexas para filtros de agregação.
   * 
   * @param sql - Expressão SQL raw para a cláusula HAVING
   * @param bindings - Array de valores para os placeholders na SQL
   * @param logical - Conectivo lógico ('AND' ou 'OR', padrão: 'AND')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - HAVING raw simples
   * const departments = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as count'])
   *   .groupBy('department')
   *   .havingRaw('COUNT(*) > 5 AND COUNT(*) < 100')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - HAVING raw com bindings
   * const highValueDepartments = await new QueryBuilder<User>('users')
   *   .select(['department', 'COUNT(*) as count', 'AVG(salary) as avg_salary'])
   *   .groupBy('department')
   *   .havingRaw('COUNT(*) >= ? AND AVG(salary) > ?', [10, 50000])
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de análise financeira com filtros complexos
   * class FinancialAnalysisSystem {
   *   static async analyzeDepartmentFinancials(
   *     financialCriteria: FinancialCriteria,
   *     fiscalYear: string
   *   ): Promise<DepartmentFinancialReport[]> {
   *     let query = new QueryBuilder<Department>('departments')
   *       .select([
   *         'departments.id',
   *         'departments.name',
   *         'departments.budget',
   *         'COUNT(DISTINCT employees.id) as employee_count',
   *         'SUM(employees.salary) as total_salary_cost',
   *         'AVG(employees.salary) as avg_salary',
   *         'SUM(expenses.amount) as total_expenses',
   *         'SUM(revenue.amount) as total_revenue',
   *         'SUM(revenue.amount) - SUM(expenses.amount) - SUM(employees.salary) as net_profit',
   *         'CASE WHEN departments.budget > 0 THEN ((SUM(expenses.amount) + SUM(employees.salary)) / departments.budget) * 100 ELSE 0 END as budget_utilization_percent'
   *       ])
   *       .leftJoin('users as employees', 'departments.id = employees.department_id')
   *       .leftJoin('expenses', 'departments.id = expenses.department_id AND expenses.fiscal_year = ?')
   *       .leftJoin('revenue', 'departments.id = revenue.department_id AND revenue.fiscal_year = ?')
   *       .where('departments.active', '=', true)
   *       .where('employees.active', '=', true)
   *       .groupBy('departments.id')
   *       .havingRaw(`
   *         COUNT(DISTINCT employees.id) >= ? AND
   *         SUM(employees.salary) > ? AND
   *         SUM(revenue.amount) > ? AND
   *         (SUM(revenue.amount) - SUM(expenses.amount) - SUM(employees.salary)) > ? AND
   *         CASE WHEN departments.budget > 0 THEN ((SUM(expenses.amount) + SUM(employees.salary)) / departments.budget) * 100 ELSE 0 END <= ?
   *       `, [
   *         financialCriteria.minEmployees,
   *         financialCriteria.minSalaryCost,
   *         financialCriteria.minRevenue,
   *         financialCriteria.minNetProfit,
   *         financialCriteria.maxBudgetUtilization
   *       ])
   *       .orderBy('net_profit', 'DESC')
   *       .orderBy('budget_utilization_percent', 'ASC');
   *     
   *     const result = await query.all();
   *     
   *     return result.map(row => ({
   *       departmentId: row.id,
   *       departmentName: row.name,
   *       budget: row.budget,
   *       employeeCount: row.employee_count,
   *       totalSalaryCost: row.total_salary_cost,
   *       averageSalary: row.avg_salary,
   *       totalExpenses: row.total_expenses,
   *       totalRevenue: row.total_revenue,
   *       netProfit: row.net_profit,
   *       budgetUtilizationPercent: row.budget_utilization_percent,
   *       financialHealth: this.assessFinancialHealth(row),
   *       recommendations: this.generateFinancialRecommendations(row)
   *     }));
   *   }
   *   
   *   private static assessFinancialHealth(dept: any): string {
   *     if (dept.net_profit > 0 && dept.budget_utilization_percent < 80) {
   *       return 'Excellent';
   *     } else if (dept.net_profit > 0 && dept.budget_utilization_percent < 95) {
   *       return 'Good';
   *     } else if (dept.net_profit > 0) {
   *       return 'Fair';
   *     } else {
   *       return 'Poor';
   *     }
   *   }
   * }
   */
  havingRaw(sql: string, bindings: any[] = [], logical: 'AND' | 'OR' = 'AND'): this { this.havingClauses.push({ type: 'raw', sql, logical } as any); return this; }
  /**
 * Seleciona todas as colunas exceto as especificadas.
 * Útil para excluir colunas sensíveis ou desnecessárias da consulta.
 * 
 * @param excludeColumns - Array de colunas a serem excluídas da seleção
 * @returns Instância atual do QueryBuilder para method chaining
 * 
 * @example
 * // Exemplo básico - Excluir colunas sensíveis
 * const users = await new QueryBuilder<User>('users')
 *   .selectAllExcept(['password', 'ssn', 'credit_card'])
 *   .all();
 * 
 * @example
 * // Exemplo intermediário - Excluir colunas de auditoria
 * const products = await new QueryBuilder<Product>('products')
 *   .selectAllExcept(['created_by', 'updated_by', 'deleted_at'])
 *   .where('active', '=', true)
 *   .all();
 * 
 * @example
 * // Exemplo avançado - Sistema de permissões baseado em colunas
 * class SecureDataAccess {
 *   static async getUserData(userId: number, userRole: string): Promise<any[]> {
 *     const baseQuery = new QueryBuilder<User>('users')
 *       .where('id', '=', userId);
 *     
 *     // Define colunas sensíveis baseadas no papel do usuário
 *     const sensitiveColumns = this.getSensitiveColumnsForRole(userRole);
 *     
 *     return await baseQuery
 *       .selectAllExcept(sensitiveColumns)
 *       .all();
 *   }
 *   
 *   private static getSensitiveColumnsForRole(role: string): string[] {
 *     switch (role) {
 *       case 'admin':
 *         return ['internal_notes'];
 *       case 'manager':
 *         return ['salary', 'internal_notes', 'performance_reviews'];
 *       case 'employee':
 *         return ['salary', 'internal_notes', 'performance_reviews', 'hr_notes'];
 *       default:
 *         return ['salary', 'internal_notes', 'performance_reviews', 'hr_notes', 'personal_info'];
 *     }
 *   }
 * }
 */
selectAllExcept(excludeColumns: (keyof T | string)[]): this {
  this.track('selectAllExcept', { excludeColumns });
  // Para implementar selectAllExcept, precisamos primeiro obter todas as colunas da tabela
  // Como isso pode variar entre bancos, vamos usar uma abordagem genérica
  this.selectColumns = ['*'];
  this.pendingAction = { 
    type: 'selectAllExcept', 
    data: excludeColumns.map(c => String(c)) 
  };
  return this;
}
  
  
  /**
 * Gera estatísticas completas da tabela atual.
 * Inclui contagens, médias, mínimos, máximos e outras métricas úteis.
 * 
 * @param options - Opções para personalizar as estatísticas
 * @returns Instância atual do QueryBuilder configurada para estatísticas
 * 
 * @example
 * // Exemplo básico - Estatísticas simples
 * const stats = await new QueryBuilder<User>('users')
 *   .stats()
 *   .get();
 * 
 * @example
 * // Exemplo intermediário - Estatísticas com filtros
 * const activeUserStats = await new QueryBuilder<User>('users')
 *   .where('active', '=', true)
 *   .stats({ includePercentiles: true, includeNullCounts: true })
 *   .get();
 * 
 * @example
 * // Exemplo avançado - Sistema de análise de dados
 * class DataAnalyticsSystem {
 *   static async generateTableReport(tableName: string): Promise<TableReport> {
 *     const stats = await new QueryBuilder<any>(tableName)
 *       .stats({
 *         includePercentiles: true,
 *         includeNullCounts: true,
 *         includeDistinctCounts: true,
 *         includeDataTypes: true
 *       })
 *       .get();
 *     
 *     return {
 *       tableName,
 *       generatedAt: new Date(),
 *       totalRecords: stats.total_records,
 *       columnStats: this.processColumnStats(stats),
 *       dataQualityScore: this.calculateDataQualityScore(stats),
 *       recommendations: this.generateRecommendations(stats)
 *     };
 *   }
 *   
 *   private static processColumnStats(stats: any): ColumnStats[] {
 *     // Processa estatísticas das colunas
 *     return Object.keys(stats)
 *       .filter(key => key.includes('_stats'))
 *       .map(key => this.parseColumnStats(key, stats[key]));
 *   }
 * }
 */
  stats(options: {
    includePercentiles?: boolean;
    includeNullCounts?: boolean;
    includeDistinctCounts?: boolean;
    includeDataTypes?: boolean;
    customColumns?: string[];
  } = {}): this {
    this.track('stats', { options });

    // Limpa seleções anteriores
    this.selectColumns = [];

    // Adiciona estatísticas básicas
    this.selectExpression('COUNT(*)', 'total_records');

    // Adiciona estatísticas para colunas numéricas (se disponíveis)
    // Como não sabemos a estrutura da tabela, usamos uma abordagem genérica
    this.selectExpression('COUNT(CASE WHEN id IS NOT NULL THEN 1 END)', 'records_with_id');

    // Adiciona estatísticas opcionais baseadas nas opções
    if (options.includeNullCounts) {
      this.selectExpression('COUNT(CASE WHEN id IS NULL THEN 1 END)', 'null_id_count');
    }

    if (options.includeDistinctCounts) {
      this.selectExpression('COUNT(DISTINCT id)', 'distinct_id_count');
    }

    // Adiciona colunas customizadas se fornecidas
    if (options.customColumns) {
      options.customColumns.forEach(col => {
        this.selectExpression(`COUNT(CASE WHEN ${col} IS NOT NULL THEN 1 END)`, `${col}_not_null_count`);
        this.selectExpression(`COUNT(CASE WHEN ${col} IS NULL THEN 1 END)`, `${col}_null_count`);
      });
    }

    return this;
  }
  /**
   * Adiciona uma cláusula WHERE para busca em múltiplas colunas com relevância.
   * Similar ao whereSearch mas com scoring de relevância.
   * 
   * @param searchTerm - Termo de busca
   * @param columns - Colunas para buscar
   * @param weights - Pesos opcionais para cada coluna (maior peso = maior relevância)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca com relevância
   * const results = await new QueryBuilder<Product>('products')
   *   .whereRelevanceSearch('laptop', ['name', 'description', 'tags'])
   *   .orderBy('relevance_score', 'DESC')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca com pesos personalizados
   * const results = await new QueryBuilder<Article>('articles')
   *   .whereRelevanceSearch('machine learning', ['title', 'content', 'tags'], [3, 1, 2])
   *   .orderBy('relevance_score', 'DESC')
   *   .limit(20)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca inteligente
   * class IntelligentSearchSystem {
   *   static async searchWithContext(
   *     searchTerm: string, 
   *     userPreferences: UserPreferences,
   *     searchContext: SearchContext
   *   ): Promise<SearchResult[]> {
   *     // Define pesos baseados no contexto e preferências do usuário
   *     const columnWeights = this.calculateColumnWeights(userPreferences, searchContext);
   *     
   *     const results = await new QueryBuilder<Content>('content')
   *       .whereRelevanceSearch(searchTerm, ['title', 'content', 'tags', 'category'], columnWeights)
   *       .when(searchContext.includeRecent, q => q.where('created_at', '>=', this.getRecentDate()))
   *       .when(searchContext.userId, q => q.where('user_id', '=', searchContext.userId))
   *       .orderBy('relevance_score', 'DESC')
   *       .limit(searchContext.maxResults || 50)
   *       .all();
   *     
   *     return results.map(result => ({
   *       ...result,
   *       personalizedScore: this.calculatePersonalizedScore(result, userPreferences),
   *       contextRelevance: this.calculateContextRelevance(result, searchContext)
   *     }));
   *   }
   *   
   *   private static calculateColumnWeights(prefs: UserPreferences, context: SearchContext): number[] {
   *     // Lógica para calcular pesos baseados em preferências e contexto
   *     return [3, 1, 2, 1.5];
   *   }
   * }
   */
  whereRelevanceSearch(
    searchTerm: string,
    columns: (keyof T | string)[],
    weights: number[] = []
  ): this {
    if (!searchTerm) return this;

    this.track('whereRelevanceSearch', { searchTerm, columns, weights });

    // Normaliza pesos se fornecidos
    const normalizedWeights = weights.length === columns.length ? weights : columns.map(() => 1);

    // Cria expressão de relevância
    const relevanceExpression = columns
      .map((col, index) => {
        const weight = normalizedWeights[index];
        return `CASE WHEN ${String(col)} LIKE ? THEN ${weight} ELSE 0 END`;
      })
      .join(' + ');

    // Adiciona busca e score de relevância
    this.whereRawSearch(searchTerm, columns);
    this.selectExpression(relevanceExpression, 'relevance_score');

    return this;
  }
  /**
   * Adiciona uma cláusula WHERE para busca fuzzy (aproximada).
   * Útil para busca com erros de digitação ou variações.
   * 
   * @param searchTerm - Termo de busca
   * @param columns - Colunas para buscar
   * @param threshold - Limite de similaridade (0-1, padrão: 0.7)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca fuzzy simples
   * const results = await new QueryBuilder<User>('users')
   *   .whereFuzzySearch('jhon', ['name', 'email'])
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca fuzzy com threshold personalizado
   * const results = await new QueryBuilder<Product>('products')
   *   .whereFuzzySearch('laptp', ['name', 'description'], 0.6)
   *   .orderBy('similarity_score', 'DESC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de correção automática de busca
   * class AutoCorrectSearchSystem {
   *   static async searchWithCorrections(
   *     searchTerm: string,
   *     searchHistory: SearchHistory[],
   *     userTypingPatterns: TypingPattern[]
   *   ): Promise<AutoCorrectResult[]> {
   *     // Analisa padrões de digitação do usuário
   *     const commonMistakes = this.analyzeTypingPatterns(userTypingPatterns);
   *     
   *     // Gera variações da busca
   *     const searchVariations = this.generateSearchVariations(searchTerm, commonMistakes);
   *     
   *     let allResults: any[] = [];
   *     
   *     // Busca com cada variação
   *     for (const variation of searchVariations) {
   *       const results = await new QueryBuilder<Product>('products')
   *         .whereFuzzySearch(variation, ['name', 'description', 'tags'], 0.5)
   *         .selectExpression(`
   *           CASE 
   *             WHEN name LIKE ? THEN 1.0
   *             WHEN name LIKE ? THEN 0.8
   *             ELSE 0.6
   *           END
   *         `, 'exact_match_score')
   *         .limit(10)
   *         .all();
   *       
   *       allResults.push(...results.map(r => ({ ...r, originalSearch: searchTerm, variation })));
   *     }
   *     
   *     // Remove duplicatas e ordena por relevância
   *     return this.deduplicateAndRank(allResults, searchTerm);
   *   }
   *   
   *   private static analyzeTypingPatterns(patterns: TypingPattern[]): string[] {
   *     // Lógica para analisar padrões de digitação
   *     return ['th->t', 'ph->f', 'ck->k'];
   *   }
   * }
   */
  whereFuzzySearch(
    searchTerm: string,
    columns: (keyof T | string)[],
    threshold: number = 0.7
  ): this {
    if (!searchTerm) return this;
  
    this.track('whereFuzzySearch', { searchTerm, columns, threshold });
  
    // Para compatibilidade com todos os bancos, usamos LIKE com wildcards
    const searchConditions = columns.map(col =>
      `${String(col)} LIKE ? OR ${String(col)} LIKE ? OR ${String(col)} LIKE ?`
    ).join(' OR ');
  
    const bindings = columns.flatMap(() => [
      `%${searchTerm}%`,           // Contém o termo
      `%${searchTerm}`,            // Termina com o termo
      `${searchTerm}%`             // Começa com o termo
    ]);
  
    this.whereRaw(`(${searchConditions})`, bindings);
  
    // Adiciona score de similaridade básico aos selectColumns
    const similarityExpression = `
      CASE 
        WHEN ${columns.map(col => `${String(col)} = ?`).join(' OR ')} THEN 1.0
        WHEN ${columns.map(col => `${String(col)} LIKE ?`).join(' OR ')} THEN 0.9
        WHEN ${columns.map(col => `${String(col)} LIKE ?`).join(' OR ')} THEN 0.8
        WHEN ${columns.map(col => `${String(col)} LIKE ?`).join(' OR ')} THEN 0.7
        ELSE 0.5
      END
    `;
  
    // Adiciona a expressão similarity_score aos selectColumns
    this.selectExpression(similarityExpression, 'similarity_score');
  
    // Adiciona bindings para o score
    const scoreBindings = [
      ...columns.map(() => searchTerm),                    // Exato
      ...columns.map(() => `${searchTerm}%`),             // Começa com
      ...columns.map(() => `%${searchTerm}`),             // Termina com
      ...columns.map(() => `%${searchTerm}%`)             // Contém
    ];
  
    // Armazena bindings para uso posterior
    this.pendingAction = {
      type: 'fuzzySearch',
      data: { searchTerm, columns, threshold, scoreBindings }
    };
  
    return this;
  }

  /**
 * Adiciona uma cláusula WHERE para busca por proximidade geográfica.
 * Compatível com bancos que suportam tipos geoespaciais.
 * 
 * @param latColumn - Coluna de latitude
 * @param lngColumn - Coluna de longitude
 * @param lat - Latitude de referência
 * @param lng - Longitude de referência
 * @param radiusKm - Raio de busca em quilômetros
 * @returns Instância atual do QueryBuilder para method chaining
 * 
 * @example
 * // Exemplo básico - Busca por proximidade
 * const nearbyStores = await new QueryBuilder<Store>('stores')
 *   .whereNearby('latitude', 'longitude', -23.5505, -46.6333, 10)
 *   .orderBy('distance_km', 'ASC')
 *   .all();
 * 
 * @example
 * // Exemplo intermediário - Busca por proximidade com filtros
 * const nearbyRestaurants = await new QueryBuilder<Restaurant>('restaurants')
 *   .whereNearby('lat', 'lng', userLat, userLng, 5)
 *   .where('cuisine_type', 'IN', ['italian', 'pizza'])
 *   .where('rating', '>=', 4.0)
 *   .orderBy('distance_km', 'ASC')
 *   .limit(20)
 *   .all();
 * 
 * @example
 * // Exemplo avançado - Sistema de recomendação baseado em localização
 * class LocationBasedRecommendationSystem {
 *   static async getPersonalizedRecommendations(
 *     userLocation: UserLocation,
 *     userPreferences: UserPreferences,
 *     context: RecommendationContext
 *   ): Promise<LocationRecommendation[]> {
 *     // Calcula raio baseado no contexto (transporte, tempo disponível, etc.)
 *     const searchRadius = this.calculateSearchRadius(context);
 *     
 *     // Busca locais próximos
 *     const nearbyPlaces = await new QueryBuilder<Place>('places')
 *       .whereNearby('latitude', 'longitude', userLocation.lat, userLocation.lng, searchRadius)
 *       .where('category', 'IN', userPreferences.categories)
 *       .where('price_range', '<=', userPreferences.maxPrice)
 *       .where('open_now', '=', true)
 *       .selectExpression(`
 *         CASE 
 *           WHEN rating >= 4.5 THEN 3
 *           WHEN rating >= 4.0 THEN 2
 *           WHEN rating >= 3.5 THEN 1
 *           ELSE 0
 *         END + 
 *         CASE 
 *           WHEN distance_km <= 1 THEN 3
 *           WHEN distance_km <= 3 THEN 2
 *           WHEN distance_km <= 5 THEN 1
 *           ELSE 0
 *         END
 *       `, 'recommendation_score')
 *       .orderBy('recommendation_score', 'DESC')
 *       .orderBy('distance_km', 'ASC')
 *       .limit(50)
 *       .all();
 *     
 *     // Aplica filtros adicionais baseados no contexto
 *     return this.applyContextualFilters(nearbyPlaces, context);
 *   }
 *   
 *   private static calculateSearchRadius(context: RecommendationContext): number {
 *     switch (context.transportMode) {
 *       case 'walking': return 2;
 *       case 'biking': return 5;
 *       case 'driving': return 15;
 *       default: return 5;
 *     }
 *   }
 * }
 */
  whereNearby(
    latColumn: keyof T | string,
    lngColumn: keyof T | string,
    lat: number,
    lng: number,
    radiusKm: number
  ): this {
    this.track('whereNearby', { latColumn, lngColumn, lat, lng, radiusKm });

    const executor = QueryKitConfig.defaultExecutor;
    const dialect = executor?.dialect || QueryKitConfig.defaultDialect || 'sqlite';

    let distanceExpression: string;
    let whereExpression: string;

    switch (dialect) {
      case 'mysql':
        distanceExpression = `
        (6371 * acos(cos(radians(?)) * cos(radians(${String(latColumn)})) * 
         cos(radians(${String(lngColumn)}) - radians(?)) + 
         sin(radians(?)) * sin(radians(${String(latColumn)}))))
      `;
        whereExpression = `${distanceExpression} <= ?`;
        break;
      case 'postgres':
        distanceExpression = `
        (6371 * acos(cos(radians(?)) * cos(radians(${String(latColumn)})) * 
         cos(radians(${String(lngColumn)}) - radians(?)) + 
         sin(radians(?)) * sin(radians(${String(latColumn)}))))
      `;
        whereExpression = `${distanceExpression} <= ?`;
        break;
      default:
        // Outros bancos - usa fórmula Haversine genérica
        distanceExpression = `
        (6371 * acos(cos(radians(?)) * cos(radians(${String(latColumn)})) * 
         cos(radians(${String(lngColumn)}) - radians(?)) + 
         sin(radians(?)) * sin(radians(${String(latColumn)}))))
      `;
        whereExpression = `${distanceExpression} <= ?`;
    }

    this.whereRaw(whereExpression, [lat, lng, lat, radiusKm]);
    this.selectExpression(distanceExpression, 'distance_km');

    return this;
  }
  /**
   * Adiciona uma cláusula WHERE para busca por intervalo de datas com timezone.
   * Útil para aplicações que precisam lidar com diferentes fusos horários.
   * 
   * @param column - Coluna de data/hora
   * @param startDate - Data/hora de início
   * @param endDate - Data/hora de fim
   * @param timezone - Fuso horário (padrão: 'UTC')
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca por intervalo com timezone
   * const results = await new QueryBuilder<Event>('events')
   *   .whereDateRangeTz('start_time', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-31T23:59:59Z'), 'America/Sao_Paulo')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca por horário de trabalho
   * const workHoursEvents = await new QueryBuilder<Meeting>('meetings')
   *   .whereDateRangeTz('scheduled_time', workDayStart, workDayEnd, userTimezone)
   *   .where('participant_id', '=', userId)
   *   .orderBy('scheduled_time', 'ASC')
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de agendamento global
   * class GlobalSchedulingSystem {
   *   static async findAvailableSlots(
   *     participants: Participant[],
   *     meetingDuration: number,
   *     preferredTimeRanges: TimeRange[],
   *     timezoneConstraints: TimezoneConstraint[]
   *   ): Promise<AvailableSlot[]> {
   *     // Obtém fusos horários de todos os participantes
   *     const participantTimezones = participants.map(p => p.timezone);
   *     
   *     let availableSlots: AvailableSlot[] = [];
   *     
   *     for (const timeRange of preferredTimeRanges) {
   *       // Busca slots disponíveis em cada fuso horário
   *       for (const timezone of participantTimezones) {
   *         const slots = await new QueryBuilder<CalendarSlot>('calendar_slots')
   *           .whereDateRangeTz('start_time', timeRange.start, timeRange.end, timezone)
   *           .where('participant_id', 'IN', participants.map(p => p.id))
   *           .where('status', '=', 'available')
   *           .where('duration_minutes', '>=', meetingDuration)
   *           .selectExpression(`
   *             CASE 
   *               WHEN timezone = ? THEN 3
   *               WHEN timezone IN (?) THEN 2
   *               ELSE 1
   *             END
   *           `, 'timezone_priority')
   *           .orderBy('timezone_priority', 'DESC')
   *           .orderBy('start_time', 'ASC')
   *           .all();
   *         
   *         availableSlots.push(...slots.map(slot => ({
   *           ...slot,
   *           timezone,
   *           localTime: this.convertToLocalTime(slot.start_time, timezone)
   *         })));
   *       }
   *     }
   *     
   *     // Remove conflitos e ordena por prioridade
   *     return this.removeConflictsAndSort(availableSlots, participants);
   *   }
   *   
   *   private static convertToLocalTime(utcTime: Date, timezone: string): Date {
   *     // Lógica para converter UTC para timezone local
   *     return new Date(utcTime.toLocaleString('en-US', { timeZone: timezone }));
   *   }
   * }
   */
  whereDateRangeTz(
    column: keyof T | string,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC'
  ): this {
    this.track('whereDateRangeTz', { column, startDate, endDate, timezone });

    const executor = QueryKitConfig.defaultExecutor;
    const dialect = executor?.dialect || QueryKitConfig.defaultDialect || 'sqlite';

    let dateExpression: string;

    switch (dialect) {
      case 'mysql':
        dateExpression = `CONVERT_TZ(${String(column)}, 'UTC', ?) BETWEEN ? AND ?`;
        break;
      case 'postgres':
        dateExpression = `${String(column)} AT TIME ZONE 'UTC' AT TIME ZONE ? BETWEEN ? AND ?`;
        break;
      case 'oracle':
        dateExpression = `FROM_TZ(${String(column)}, 'UTC') AT TIME ZONE ? BETWEEN ? AND ?`;
        break;
      default:
        // Outros bancos - usa comparação direta
        dateExpression = `${String(column)} BETWEEN ? AND ?`;
        this.whereRaw(dateExpression, [startDate, endDate]);
        return this;
    }

    this.whereRaw(dateExpression, [timezone, startDate, endDate]);
    return this;
  }
  /**
   * Adiciona uma cláusula WHERE para busca por padrões de texto usando regex.
   * Compatível com bancos que suportam regex.
   * 
   * @param column - Coluna de texto para buscar
   * @param pattern - Padrão regex
   * @param flags - Flags do regex (padrão: 'i' para case-insensitive)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Busca por padrão regex
   * const results = await new QueryBuilder<User>('users')
   *   .whereRegex('email', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
   *   .all();
   * 
   * @example
   * // Exemplo intermediário - Busca por formato de telefone
   * const validPhones = await new QueryBuilder<Contact>('contacts')
   *   .whereRegex('phone', '^\\+?[1-9]\\d{1,14}$')
   *   .where('active', '=', true)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de validação de dados
   * class DataValidationSystem {
   *   static async validateAndCleanData(
   *     tableName: string,
   *     validationRules: ValidationRule[]
   *   ): Promise<ValidationReport> {
   *     const report: ValidationReport = {
   *       tableName,
   *       totalRecords: 0,
   *       validRecords: 0,
   *       invalidRecords: 0,
   *       violations: []
   *     };
   *     
   *     // Obtém total de registros
   *     const totalResult = await new QueryBuilder<any>(tableName)
   *       .selectExpression('COUNT(*)', 'total')
   *       .get();
   *     
   *     report.totalRecords = totalResult.total;
   *     
   *     // Valida cada regra
   *     for (const rule of validationRules) {
   *       if (rule.type === 'regex') {
   *         const invalidRecords = await new QueryBuilder<any>(tableName)
   *           .whereRegex(rule.column, rule.pattern, rule.flags)
   *           .select([rule.column, 'id'])
   *           .all();
   *         
   *         report.violations.push({
   *           rule: rule.name,
   *           column: rule.column,
   *           invalidCount: invalidRecords.length,
   *           examples: invalidRecords.slice(0, 5)
   *         });
   *         
   *         report.invalidRecords += invalidRecords.length;
   *       }
   *     }
   *     
   *     report.validRecords = report.totalRecords - report.invalidRecords;
   *     
   *     return report;
   *   }
   *   
   *   static getCommonValidationRules(): ValidationRule[] {
   *     return [
   *       {
   *         name: 'Valid Email',
   *         type: 'regex',
   *         column: 'email',
   *         pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
   *         flags: 'i'
   *       },
   *       {
   *         name: 'Valid Phone',
   *         type: 'regex',
   *         column: 'phone',
   *         pattern: '^\\+?[1-9]\\d{1,14}$',
   *         flags: ''
   *       },
   *       {
   *         name: 'Valid URL',
   *         type: 'regex',
   *         column: 'website',
   *         pattern: '^https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+([\\w\\-\\.,@?^=%&:\\/~\\+#]*[\\w\\-\\@?^=%&\\/~\\+#])?$',
   *         flags: 'i'
   *       }
   *     ];
   *   }
   * }
   */
  whereRegex(
    column: keyof T | string,
    pattern: string,
    flags: string = 'i'
  ): this {
    this.track('whereRegex', { column, pattern, flags });

    const executor = QueryKitConfig.defaultExecutor;
    const dialect = executor?.dialect || QueryKitConfig.defaultDialect || 'sqlite';

    let regexExpression: string;

    switch (dialect) {
      case 'mysql':
        regexExpression = `${String(column)} REGEXP ?`;
        break;
      case 'postgres':
        regexExpression = `${String(column)} ~ ?`;
        break;
      case 'oracle':
        regexExpression = `REGEXP_LIKE(${String(column)}, ?)`;
        break;
      default:
        // Outros bancos - usa LIKE como fallback
        regexExpression = `${String(column)} LIKE ?`;
        const likePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '%');
        this.whereRaw(regexExpression, [likePattern]);
        return this;
    }

    this.whereRaw(regexExpression, [pattern]);
    return this;
  }

  /**
   * Adiciona uma cláusula WHERE para busca por valores que correspondem a um padrão específico.
   * Útil para filtros de texto com wildcards.
   * 
   * @param column - Coluna de texto para filtrar
   * @param pattern - Padrão com wildcards (% para qualquer sequência, _ para um caractere)
   * @param caseSensitive - Se a busca deve ser case-sensitive (padrão: false)
   * @returns Instância atual do QueryBuilder para method chaining
   * 
   * @example
   * // Exemplo básico - Padrão com wildcards
   * const results = await new QueryBuilder<User>('users')
   *   .wherePattern('name', 'Jo%n')
   *   .all();
   * 
   * // Exemplo intermediário - Padrão case-sensitive
   * const results = await new QueryBuilder<Product>('products')
   *   .wherePattern('sku', 'PROD_%', true)
   *   .all();
   * 
   * @example
   * // Exemplo avançado - Sistema de busca por padrões de arquivo
   * class FilePatternSearchSystem {
   *   static async searchFilesByPattern(
   *     baseDirectory: string,
   *     searchPatterns: FilePattern[],
   *     searchOptions: SearchOptions
   *   ): Promise<FileSearchResult[]> {
   *     let allResults: FileSearchResult[] = [];
   *     
   *     for (const pattern of searchPatterns) {
   *       // Constrói query baseada no tipo de padrão
   *       let query = new QueryBuilder<FileRecord>('files')
   *         .where('directory', 'LIKE', `${baseDirectory}%`);
   *       
   *       if (pattern.type === 'filename') {
   *         query = query.wherePattern('filename', pattern.pattern, pattern.caseSensitive);
   *       } else if (pattern.type === 'extension') {
   *         query = query.wherePattern('extension', pattern.pattern, pattern.caseSensitive);
   *       } else if (pattern.type === 'path') {
   *         query = query.wherePattern('full_path', pattern.pattern, pattern.caseSensitive);
   *       }
   *       
   *       // Aplica filtros adicionais
   *       if (searchOptions.minSize) {
   *         query = query.where('file_size', '>=', searchOptions.minSize);
   *       }
   *       
   *       if (searchOptions.maxSize) {
   *         query = query.where('file_size', '<=', searchOptions.maxSize);
   *       }
   *       
   *       if (searchOptions.modifiedAfter) {
   *         query = query.where('modified_date', '>=', searchOptions.modifiedAfter);
   *       }
   *       
   *       if (searchOptions.fileTypes) {
   *         query = query.whereIn('extension', searchOptions.fileTypes);
   *       }
   *       
   *       const results = await query
   *         .orderBy('filename', 'ASC')
   *         .limit(searchOptions.maxResults || 1000)
   *         .all();
   *       
   *       allResults.push(...results.map(r => ({ ...r, matchedPattern: pattern.name })));
   *     }
   *     
   *     // Remove duplicatas e ordena por relevância
   *     return this.deduplicateAndRank(allResults, searchPatterns);
   *   }
   *   
   *   private static deduplicateAndRank(results: FileSearchResult[], patterns: FilePattern[]): FileSearchResult[] {
   *     const uniqueResults = new Map<string, FileSearchResult>();
   *     
   *     for (const result of results) {
   *       const key = `${result.directory}/${result.filename}`;
   *       if (!uniqueResults.has(key) || this.isBetterMatch(result, uniqueResults.get(key)!, patterns)) {
   *         uniqueResults.set(key, result);
   *       }
   *     }
   *     
   *     return Array.from(uniqueResults.values())
   *       .sort((a, b) => this.calculateRelevance(b, patterns) - this.calculateRelevance(a, patterns));
   *   }
   * }
   */
  wherePattern(
    column: keyof T | string,
    pattern: string,
    caseSensitive: boolean = false
  ): this {
    this.track('wherePattern', { column, pattern, caseSensitive });

    if (caseSensitive) {
      this.where(column, 'LIKE', pattern);
    } else {
      this.whereILike(column, pattern);
    }

    return this;
  }
}