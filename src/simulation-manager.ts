import type { QueryBuilder } from './query-builder';
import { QueryKitConfig } from './config';

/**
 * Estado virtual para simulação de banco de dados.
 * Mapeia nomes de tabelas para arrays de dados simulados.
 */
type VirtualState = Map<string, any[]>;

/**
 * Gerenciador de simulação para o QueryKit.
 * Permite executar queries em dados simulados sem afetar o banco real.
 * Implementa o padrão Singleton para acesso global.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const simulationManager = SimulationManager.getInstance();
 * const mockData = {
 *   users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }],
 *   products: [{ id: 1, name: 'Product A', price: 100 }]
 * };
 * 
 * // Como usar
 * await simulationManager.start(mockData);
 * const users = simulationManager.getStateFor('users');
 * 
 * // Output: Simulação ativa com dados mock carregados
 * ```
 */
class SimulationManager {
  private static instance: SimulationManager;
  private active: boolean = false;
  private virtualState: VirtualState = new Map();

  private constructor() {}

  /**
   * Obtém a instância única do SimulationManager (Singleton).
   * Cria uma nova instância se não existir.
   * 
   * @returns Instância única do SimulationManager
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * // Nenhum - método estático
   * 
   * // Como usar
   * const manager = SimulationManager.getInstance();
   * 
   * // Output: Instância única do gerenciador de simulação
   * ```
   */
  public static getInstance(): SimulationManager {
    if (!SimulationManager.instance) {
      SimulationManager.instance = new SimulationManager();
    }
    return SimulationManager.instance;
  }

  /**
   * Verifica se a simulação está ativa.
   * Prioriza configuração global se disponível.
   * 
   * @returns true se a simulação estiver ativa, false caso contrário
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const simulationManager = SimulationManager.getInstance();
   * 
   * // Como usar
   * const isActive = simulationManager.isActive();
   * 
   * // Output: true se simulação estiver ativa
   * ```
   */
  public isActive(): boolean {
    return QueryKitConfig.simulation?.isActive() ?? this.active;
  }

  /**
   * Inicia a simulação com estado inicial.
   * Aceita dados diretos ou QueryBuilders para carregar dados do banco.
   * 
   * @param initialState - Estado inicial das tabelas (dados ou queries)
   * @returns Promise que resolve quando a simulação for iniciada
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const simulationManager = SimulationManager.getInstance();
   * const initialState = {
   *   users: [{ id: 1, name: 'John' }],
   *   products: table('products').select('*').where('active', true)
   * };
   * 
   * // Como usar
   * await simulationManager.start(initialState);
   * 
   * // Output: Simulação iniciada com dados mock e dados do banco
   * ```
   */
  public async start(initialState: Record<string, any[] | QueryBuilder<any>>): Promise<void> {
    if (QueryKitConfig.simulation) return QueryKitConfig.simulation.start(initialState) as any;
    this.active = true;
    this.virtualState.clear();
    for (const key in initialState) {
      const value = initialState[key];
      if (Array.isArray(value)) {
        this.virtualState.set(key, JSON.parse(JSON.stringify(value)));
      } else {
        const { sql, bindings } = value.toSql();
        const exec = QueryKitConfig.defaultExecutor;
        if (!exec) { this.virtualState.set(key, []); continue; }
        const result = await exec.executeQuery(sql, bindings);
        const data = result.data as any[];
        this.virtualState.set(key, data);
      }
    }
  }

  /**
   * Para a simulação e limpa o estado virtual.
   * Restaura o comportamento normal do banco de dados.
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const simulationManager = SimulationManager.getInstance();
   * await simulationManager.start({ users: [] });
   * 
   * // Como usar
   * simulationManager.stop();
   * 
   * // Output: Simulação parada e estado virtual limpo
   * ```
   */
  public stop(): void {
    if (QueryKitConfig.simulation) { (QueryKitConfig.simulation.stop() as any); }
    this.active = false;
    this.virtualState.clear();
  }

  /**
   * Obtém o estado atual de uma tabela na simulação.
   * Retorna dados simulados se disponíveis.
   * 
   * @param tableName - Nome da tabela para obter estado
   * @returns Array com dados da tabela ou undefined se não existir
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const simulationManager = SimulationManager.getInstance();
   * await simulationManager.start({ users: [{ id: 1, name: 'John' }] });
   * 
   * // Como usar
   * const users = simulationManager.getStateFor('users');
   * 
   * // Output: [{ id: 1, name: 'John' }]
   * ```
   */
  public getStateFor(tableName: string): any[] | undefined {
    if (QueryKitConfig.simulation) return QueryKitConfig.simulation.getStateFor(tableName);
    return this.virtualState.get(tableName);
  }

  /**
   * Atualiza o estado de uma tabela na simulação.
   * Só funciona se a simulação estiver ativa.
   * 
   * @param tableName - Nome da tabela para atualizar
   * @param data - Novos dados para a tabela
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const simulationManager = SimulationManager.getInstance();
   * await simulationManager.start({ users: [] });
   * 
   * // Como usar
   * simulationManager.updateStateFor('users', [{ id: 1, name: 'New User' }]);
   * 
   * // Output: Estado da tabela 'users' atualizado na simulação
   * ```
   */
  public updateStateFor(tableName: string, data: any[]): void {
    if (this.isActive()) {
      if (QueryKitConfig.simulation) return QueryKitConfig.simulation.updateStateFor(tableName, data);
      this.virtualState.set(tableName, data);
    }
  }
}

/**
 * Instância global do SimulationManager para uso em todo o QueryKit.
 * Permite ativar/desativar simulação de forma centralizada.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * import { simulationManager } from './simulation-manager';
 * 
 * // Como usar
 * await simulationManager.start({ users: [{ id: 1, name: 'Test User' }] });
 * const isSimulating = simulationManager.isActive();
 * 
 * // Output: Simulação ativa com dados de teste
 * ```
 */
export const simulationManager = SimulationManager.getInstance(); 