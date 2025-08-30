import type { DatabaseExecutor } from './types'
import { QueryKitConfig, getExecutorForTable } from './config'
import { QueryBuilder } from './query-builder'

/**
 * Contexto passado para execução de seeds.
 * Fornece acesso ao executor e factory de QueryBuilder.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const context: SeedContext = {
 *   exec: databaseExecutor,
 *   qb: (tableName) => new QueryBuilder(tableName)
 * };
 * 
 * // Como usar
 * // Contexto passado para função de seed
 * 
 * // Output: Contexto configurado para execução de seed
 * ```
 */
export type SeedContext = {
	/** Executor do banco de dados */
	exec: DatabaseExecutor
	/** Factory para criar QueryBuilders */
	qb: <T = any>(table: string) => QueryBuilder<T>
}

/**
 * Interface para seeds executáveis.
 * Define contrato para classes de seed customizadas.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class UserSeed implements SeedRunnable<User> {
 *   async run(ctx: SeedContext): Promise<Partial<User>[]> {
 *     return [
 *       { name: 'John Doe', email: 'john@example.com' },
 *       { name: 'Jane Smith', email: 'jane@example.com' }
 *     ];
 *   }
 * }
 * 
 * // Como usar
 * await runSeed('users', new UserSeed());
 * 
 * // Output: Usuários inseridos no banco de dados
 * ```
 */
export interface SeedRunnable<T = any> {
	/**
	 * Executa o seed e retorna dados para inserção.
	 * 
	 * @param ctx - Contexto com executor e QueryBuilder
	 * @returns Promise ou array com dados para inserção
	 */
	run(ctx: SeedContext): Promise<Partial<T>[]> | Partial<T>[]
}

/**
 * Classe base para seeds customizadas.
 * Implementa SeedRunnable com comportamento padrão vazio.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * class ProductSeed extends Seed<Product> {
 *   async run(ctx: SeedContext): Promise<Partial<Product>[]> {
 *     return [
 *       { name: 'Product A', price: 100 },
 *       { name: 'Product B', price: 200 }
 *     ];
 *   }
 * }
 * 
 * // Como usar
 * await runSeed('products', new ProductSeed());
 * 
 * // Output: Produtos inseridos no banco de dados
 * ```
 */
export class Seed<T = any> implements SeedRunnable<T> {
	/**
	 * Método padrão que retorna array vazio.
	 * Deve ser sobrescrito em classes filhas.
	 * 
	 * @param _ctx - Contexto da execução (não usado na implementação padrão)
	 * @returns Array vazio
	 */
	async run(_ctx: SeedContext): Promise<Partial<T>[]> { return [] }
}

/**
 * Opções para execução de seeds.
 * Controla comportamento de inserção e tratamento de duplicatas.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const options: RunSeedOptions<User> = {
 *   truncate: true,
 *   uniqueBy: ['email'],
 *   upsert: true
 * };
 * 
 * // Como usar
 * await runSeed('users', userData, options);
 * 
 * // Output: Tabela truncada e dados inseridos com upsert por email
 * ```
 */
export type RunSeedOptions<T = any> = {
	/** Se deve truncar a tabela antes de inserir */
	truncate?: boolean
	/** Colunas para verificar duplicatas */
	uniqueBy?: (keyof T)[] | string[]
	/** Se deve fazer upsert em vez de insert simples */
	upsert?: boolean
	/** Se deve ignorar duplicatas em vez de falhar */
	ignoreDuplicates?: boolean
}

/**
 * Executa um seed em uma tabela específica.
 * Suporta dados diretos ou classes SeedRunnable.
 * Oferece opções para truncate, upsert e tratamento de duplicatas.
 * 
 * @param table - Nome da tabela para executar o seed
 * @param dataOrSeed - Dados para inserir ou classe seed executável
 * @param opts - Opções de execução
 * @returns Promise que resolve com número de linhas inseridas
 * @throws Error se não houver executor configurado
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const userData = [
 *   { name: 'John Doe', email: 'john@example.com' },
 *   { name: 'Jane Smith', email: 'jane@example.com' }
 * ];
 * 
 * // Como usar
 * const insertedRows = await runSeed('users', userData, { 
 *   truncate: true, 
 *   uniqueBy: ['email'] 
 * });
 * 
 * // Output: 2 (número de usuários inseridos)
 * ```
 */
export async function runSeed<T = any>(table: string, dataOrSeed: Partial<T>[] | SeedRunnable<T>, opts: RunSeedOptions<T> = {}): Promise<number> {
	const exec = getExecutorForTable(table)
	if (!exec) throw new Error('No executor configured for QueryKit')
	if (opts.truncate) {
		if ((exec as any).runSync) (exec as any).runSync(`DELETE FROM ${table}`, [])
		else await exec.executeQuery(`DELETE FROM ${table}`, [])
	}
	let rows: Partial<T>[]
	if (Array.isArray(dataOrSeed)) rows = dataOrSeed
	else {
		const ctx: SeedContext = { exec, qb: <X=any>(t:string)=> new QueryBuilder<X>(t) }
		const out = await dataOrSeed.run(ctx)
		rows = out || []
	}
	if (!rows.length) return 0
	// batch insert with optional conflict handling
	const uniqueKeys = (opts.uniqueBy || []) as string[]
	const shouldUpsert = !!opts.upsert
	const shouldIgnore = !!opts.ignoreDuplicates
	for (const row of rows) {
		if (uniqueKeys.length && shouldIgnore) {
			const attributes: Record<string, any> = {}
			for (const key of uniqueKeys) attributes[String(key)] = (row as any)[String(key)]
			const exists = await new QueryBuilder<any>(table).whereAll(attributes).exists()
			if (exists) continue
			await new QueryBuilder<any>(table).insert(row).make()
			continue
		}
		if (uniqueKeys.length && shouldUpsert) {
			const attributes: Record<string, any> = {}
			const values: Record<string, any> = {}
			for (const [k, v] of Object.entries(row)) {
				if (uniqueKeys.includes(k)) attributes[k] = v
				else values[k] = v
			}
			await new QueryBuilder<any>(table).updateOrInsert(attributes, values).make()
			continue
		}
		await new QueryBuilder<any>(table).insert(row).make()
	}
	return rows.length
} 