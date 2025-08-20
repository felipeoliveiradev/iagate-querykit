import type { DatabaseExecutor } from './types'
import { QueryKitConfig, getExecutorForTable } from './config'
import { QueryBuilder } from './query-builder'

export type SeedContext = {
	exec: DatabaseExecutor
	qb: <T = any>(table: string) => QueryBuilder<T>
}

export interface SeedRunnable<T = any> {
	run(ctx: SeedContext): Promise<Partial<T>[]> | Partial<T>[]
}

export class Seed<T = any> implements SeedRunnable<T> {
	async run(_ctx: SeedContext): Promise<Partial<T>[]> { return [] }
}

export type RunSeedOptions<T = any> = {
	truncate?: boolean
	uniqueBy?: (keyof T)[] | string[]
	upsert?: boolean
	ignoreDuplicates?: boolean
}

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