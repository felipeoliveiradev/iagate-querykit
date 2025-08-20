import { QueryBuilder, type RelationshipSelector } from './query-builder';
import { runSeed, type SeedRunnable } from './seed'

export class Model {
  protected static tableName: string;
  protected static banks?: string[]; 
  protected banks?: string[];
  protected fillable: string[] = [];
  protected guarded: string[] = ['id', 'created_at', 'updated_at'];

  static query<T = any>(this: any): QueryBuilder<T> {
    const qb = new QueryBuilder<T>(this.tableName);
    const banks = this.banks as string[] | undefined;
    if (banks && banks.length) qb.bank(banks);
    return qb;
  }

  static withRelations<T = any>(this: any, selector?: RelationshipSelector<T>): QueryBuilder<T> {
    const qb = (this as any).query().relationship(selector as any)
    return qb
  }

  static async seed<T = any>(this: any, dataOrSeed: Partial<T>[] | SeedRunnable<T>, opts: { truncate?: boolean } = {}): Promise<number> {
    return runSeed<T>(this.tableName, dataOrSeed, opts)
  }

  bank(bankOrBanks: string | string[]): this {
    this.banks = Array.isArray(bankOrBanks) ? bankOrBanks : [bankOrBanks];
    return this;
  }

  private applyBanks<T extends Model>(qb: QueryBuilder<T>): QueryBuilder<T> {
    if (this.banks && this.banks.length) return qb.bank(this.banks);
    return qb;
  }

  fill(attributes: Record<string, any>): void {
    const fillableAttributes = this.getFillableAttributes(attributes);
    Object.assign(this, fillableAttributes);
  }

  private getFillableAttributes(attributes: Record<string, any>): Record<string, any> {
    if (this.fillable.length > 0) {
      const result: Record<string, any> = {};
      this.fillable.forEach(key => { if (attributes[key] !== undefined) result[key] = attributes[key]; });
      return result;
    }
    if (this.guarded.length > 0) {
      const result = { ...attributes };
      this.guarded.forEach(key => { delete result[key]; });
      return result;
    }
    return attributes;
  }
  
  save(): Promise<any> {
    const queryBase = (this.constructor as typeof Model & { new(): any }).query<this>();
    const query = this.applyBanks(queryBase);
    const attributes = this.getFillableAttributes(this as any);
    if ((this as any).id) {
      return query.where('id', '=', (this as any).id).update(attributes as Partial<this>).make();
    }
    return query.insert(attributes as Partial<this>).make();
  }

  delete(): Promise<any> {
    const queryBase = (this.constructor as typeof Model & { new(): any }).query<this>();
    const query = this.applyBanks(queryBase);
    return query.where('id', '=', (this as any).id).delete().make();
  }
} 