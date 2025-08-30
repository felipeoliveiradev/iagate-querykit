import { QueryBuilder, type RelationshipSelector } from './query-builder';
import { runSeed, type SeedRunnable } from './seed'

/**
 * Classe base para modelos de dados no QueryKit.
 * Fornece funcionalidades de ORM básicas como queries, relacionamentos e seeds.
 * Suporta múltiplos bancos de dados e controle de atributos fillable/guarded.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class User extends Model {
 *   protected static tableName = 'users';
 *   protected fillable = ['name', 'email', 'age'];
 *   protected guarded = ['id', 'created_at', 'updated_at', 'password'];
 * }
 * 
 * // Como usar
 * const user = new User();
 * user.fill({ name: 'John', email: 'john@example.com', age: 30 });
 * await user.save();
 * 
 * // Output: Usuário salvo no banco de dados
 * ```
 */
export class Model {
  /** Nome da tabela para o modelo */
  protected static tableName: string;
  /** Bancos de dados estáticos para o modelo */
  protected static banks?: string[]; 
  /** Bancos de dados de instância para o modelo */
  protected banks?: string[];
  /** Atributos que podem ser preenchidos */
  protected fillable: string[] = [];
  /** Atributos que não podem ser preenchidos */
  protected guarded: string[] = ['id', 'created_at', 'updated_at'];

  /**
   * Cria um QueryBuilder estático para o modelo.
   * Configura automaticamente o nome da tabela e bancos.
   * 
   * @returns QueryBuilder configurado para o modelo
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * class User extends Model {
   *   protected static tableName = 'users';
   *   protected static banks = ['main_db', 'replica_db'];
   * }
   * 
   * // Como usar
   * const query = User.query().where('active', true);
   * const activeUsers = await query.all();
   * 
   * // Output: QueryBuilder configurado para tabela 'users' com bancos configurados
   * ```
   */
  static query<T = any>(this: any): QueryBuilder<T> {
    const qb = new QueryBuilder<T>(this.tableName);
    const banks = this.banks as string[] | undefined;
    if (banks && banks.length) qb.bank(banks);
    return qb;
  }

  /**
   * Cria um QueryBuilder com relacionamentos pré-carregados.
   * 
   * @param selector - Seletor opcional para definir quais relacionamentos carregar
   * @returns QueryBuilder configurado com relacionamentos
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * class User extends Model {
   *   protected static tableName = 'users';
   * }
   * 
   * // Como usar
   * const query = User.withRelations((rel) => {
   *   rel('posts', ['id', 'title']);
   *   rel('profile');
   * });
   * const usersWithRelations = await query.all();
   * 
   * // Output: QueryBuilder com relacionamentos configurados
   * ```
   */
  static withRelations<T = any>(this: any, selector?: RelationshipSelector<T>): QueryBuilder<T> {
    const qb = (this as any).query().relationship(selector as any)
    return qb
  }

  /**
   * Executa seed para o modelo.
   * 
   * @param dataOrSeed - Dados para inserir ou classe seed executável
   * @param opts - Opções incluindo truncate
   * @returns Promise que resolve com número de linhas inseridas
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * class User extends Model {
   *   protected static tableName = 'users';
   * }
   * 
   * const userData = [
   *   { name: 'John', email: 'john@example.com' },
   *   { name: 'Jane', email: 'jane@example.com' }
   * ];
   * 
   * // Como usar
   * const insertedRows = await User.seed(userData, { truncate: true });
   * 
   * // Output: 2 (usuários inseridos na tabela)
   * ```
   */
  static async seed<T = any>(this: any, dataOrSeed: Partial<T>[] | SeedRunnable<T>, opts: { truncate?: boolean } = {}): Promise<number> {
    return runSeed<T>(this.tableName, dataOrSeed, opts)
  }

  /**
   * Define bancos de dados para a instância do modelo.
   * 
   * @param bankOrBanks - Nome do banco ou array de nomes
   * @returns Instância do modelo para method chaining
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const user = new User();
   * 
   * // Como usar
   * user.bank('analytics_db');
   * // ou
   * user.bank(['main_db', 'backup_db']);
   * 
   * // Output: Modelo configurado para usar bancos específicos
   * ```
   */
  bank(bankOrBanks: string | string[]): this {
    this.banks = Array.isArray(bankOrBanks) ? bankOrBanks : [bankOrBanks];
    return this;
  }

  /**
   * Aplica configuração de bancos a um QueryBuilder.
   * 
   * @param qb - QueryBuilder para aplicar bancos
   * @returns QueryBuilder com bancos configurados
   */
  private applyBanks<T extends Model>(qb: QueryBuilder<T>): QueryBuilder<T> {
    if (this.banks && this.banks.length) return qb.bank(this.banks);
    return qb;
  }

  /**
   * Preenche atributos do modelo baseado em fillable/guarded.
   * Respeita as regras de segurança definidas no modelo.
   * 
   * @param attributes - Atributos para preencher
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * class User extends Model {
   *   protected fillable = ['name', 'email'];
   *   protected guarded = ['id', 'password'];
   * }
   * 
   * const user = new User();
   * 
   * // Como usar
   * user.fill({ name: 'John', email: 'john@example.com', id: 999, password: 'secret' });
   * 
   * // Output: Apenas name e email são preenchidos, id e password são ignorados
   * ```
   */
  fill(attributes: Record<string, any>): void {
    const fillableAttributes = this.getFillableAttributes(attributes);
    Object.assign(this, fillableAttributes);
  }

  /**
   * Filtra atributos baseado em fillable/guarded.
   * 
   * @param attributes - Atributos para filtrar
   * @returns Atributos filtrados e seguros
   */
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
  
  /**
   * Salva o modelo no banco de dados.
   * Cria novo registro se não tiver ID, atualiza se tiver.
   * 
   * @returns Promise que resolve com resultado da operação
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const user = new User();
   * user.fill({ name: 'John', email: 'john@example.com' });
   * 
   * // Como usar
   * const result = await user.save();
   * 
   * // Output: Usuário inserido no banco com ID gerado
   * 
   * // Para atualizar
   * user.id = 1;
   * user.name = 'John Doe';
   * await user.save();
   * 
   * // Output: Usuário atualizado no banco
   * ```
   */
  save(): Promise<any> {
    const queryBase = (this.constructor as typeof Model & { new(): any }).query<this>();
    const query = this.applyBanks(queryBase);
    const attributes = this.getFillableAttributes(this as any);
    if ((this as any).id) {
      return query.where('id', '=', (this as any).id).update(attributes as Partial<this>).make();
    }
    return query.insert(attributes as Partial<this>).make();
  }

  /**
   * Remove o modelo do banco de dados.
   * Requer que o modelo tenha ID definido.
   * 
   * @returns Promise que resolve com resultado da operação
   * @throws Error se não tiver ID definido
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const user = new User();
   * user.id = 1;
   * 
   * // Como usar
   * const result = await user.delete();
   * 
   * // Output: Usuário removido do banco de dados
   * ```
   */
  delete(): Promise<any> {
    const queryBase = (this.constructor as typeof Model & { new(): any }).query<this>();
    const query = this.applyBanks(queryBase);
    return query.where('id', '=', (this as any).id).delete().make();
  }
} 