import { QueryBuilder } from './query-builder';

export class Model {
  protected static tableName: string;
  protected fillable: string[] = [];
  protected guarded: string[] = ['id', 'created_at', 'updated_at'];

  static query<T extends Model>(this: new () => T): QueryBuilder<T> {
    return new QueryBuilder<T>((this as any).tableName);
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
    const query = (this.constructor as typeof Model & { new(): any }).query<this>();
    const attributes = this.getFillableAttributes(this as any);
    // @ts-ignore
    if ((this as any).id) {
      // @ts-ignore
      return query.where('id', '=', (this as any).id).update(attributes as Partial<this>).make();
    }
    return query.insert(attributes as Partial<this>).make();
  }
} 