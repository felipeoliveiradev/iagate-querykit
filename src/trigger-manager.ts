import { QueryKitConfig } from './config';

type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';
type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF';

export class TriggerManager {
  public createTrigger(name: string, tableName: string, timing: TriggerTiming, event: TriggerEvent, body: string): void {
    const createTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${name}
      ${timing} ${event} ON ${tableName}
      FOR EACH ROW
      BEGIN
        ${body}
      END;
    `;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(createTriggerSql, []);
  }

  public dropTrigger(name: string): void {
    const dropTriggerSql = `DROP TRIGGER IF EXISTS ${name}`;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(dropTriggerSql, []);
  }

  public listTriggers(): string[] {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const rows = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='trigger'", []).data as any[];
    return rows.map(row => row.name);
  }

  public triggerExists(name: string): boolean {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const row = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='trigger' AND name= ?", [name]).data[0];
    return !!row;
  }
} 