import type { QueryBuilder } from './query-builder';
import { QueryKitConfig } from './config';

type VirtualState = Map<string, any[]>;

class SimulationManager {
  private static instance: SimulationManager;
  private active: boolean = false;
  private virtualState: VirtualState = new Map();

  private constructor() {}

  public static getInstance(): SimulationManager {
    if (!SimulationManager.instance) {
      SimulationManager.instance = new SimulationManager();
    }
    return SimulationManager.instance;
  }

  public isActive(): boolean {
    return QueryKitConfig.simulation?.isActive() ?? this.active;
  }

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

  public stop(): void {
    if (QueryKitConfig.simulation) { (QueryKitConfig.simulation.stop() as any); }
    this.active = false;
    this.virtualState.clear();
  }

  public getStateFor(tableName: string): any[] | undefined {
    if (QueryKitConfig.simulation) return QueryKitConfig.simulation.getStateFor(tableName);
    return this.virtualState.get(tableName);
  }

  public updateStateFor(tableName: string, data: any[]): void {
    if (this.isActive()) {
      if (QueryKitConfig.simulation) return QueryKitConfig.simulation.updateStateFor(tableName, data);
      this.virtualState.set(tableName, data);
    }
  }
}

export const simulationManager = SimulationManager.getInstance(); 