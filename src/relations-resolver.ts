import { QueryBuilder } from './query-builder'

/**
 * Função seletora para definir quais relações carregar.
 * Permite especificar quais campos de cada relação incluir.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const selector: Selector = (rel) => {
 *   rel('posts', ['id', 'title', 'content']);
 *   rel('profile', ['bio', 'avatar']);
 * };
 * 
 * // Como usar
 * // Passado para attachRelations
 * 
 * // Output: Seletor configurado para carregar posts e profile
 * ```
 */
type Selector = (rel: (name: string, select?: string[]) => void) => void

/**
 * Anexa relações a registros de uma tabela baseado em definições de relacionamento.
 * Suporta hasMany, belongsTo e manyToMany com carregamento lazy.
 * 
 * @param table - Nome da tabela principal
 * @param rows - Array de registros para anexar relações
 * @param selector - Função opcional para selecionar relações específicas
 * @returns Promise que resolve com registros com relações anexadas
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const users = [
 *   { id: 1, name: 'John' },
 *   { id: 2, name: 'Jane' }
 * ];
 * 
 * // Como usar
 * const usersWithRelations = await attachRelations('users', users, (rel) => {
 *   rel('posts', ['id', 'title']);
 *   rel('profile');
 * });
 * 
 * // Output: Usuários com posts e profile carregados
 * // usersWithRelations[0].posts = [{ id: 1, title: 'Post 1' }]
 * // usersWithRelations[0].profile = { bio: 'Developer' }
 * ```
 */
export async function attachRelations(table: string, rows: any[], selector?: Selector): Promise<any[]> {
	if (!rows || rows.length === 0) return rows
	let registry: any = {}
	try {
		registry = (await import(process.env.QK_RELATIONS_PATH || '')).RELATIONS || {}
	} catch {}
	const defs = registry[table] as any[] || []
	if (defs.length === 0) return rows

	let wanted: Record<string, string[] | undefined> | 'ALL' = 'ALL'
	if (selector) {
		const tmp: Record<string, string[] | undefined> = {}
		selector((name, select) => { tmp[name] = select })
		wanted = tmp
	}

	const byId = new Map<any, any>()
	for (const r of rows) byId.set(r.id, r)

	for (const def of defs) {
		if (wanted !== 'ALL' && !(def.name in wanted)) continue
		
		// Relação hasMany: um para muitos
		if (def.kind === 'hasMany') {
			const ids = rows.map(r => r[def.localKey || 'id'])
			const children = await new QueryBuilder<any>(def.table).whereIn(def.foreignKey, ids).all()
			for (const c of children) {
				const parent = byId.get(c[def.foreignKey])
				if (!parent) continue
				parent[def.name] = parent[def.name] || []
				parent[def.name].push(c)
			}
		}
		
		// Relação belongsTo: muitos para um
		if (def.kind === 'belongsTo') {
			const fks = rows.map(r => r[def.foreignKey]).filter((v:any) => v !== undefined && v !== null)
			if (fks.length === 0) continue
			const parents = await new QueryBuilder<any>(def.table).whereIn(def.ownerKey || 'id', fks).all()
			const parentByKey = new Map<any, any>(parents.map((p:any) => [p[def.ownerKey || 'id'], p]))
			for (const r of rows) r[def.name] = parentByKey.get(r[def.foreignKey]) || null
		}
		
		// Relação manyToMany: muitos para muitos através de tabela pivot
		if (def.kind === 'manyToMany') {
			const ids = rows.map(r => r.id)
			const join = def.through.table
			const leftKey = def.through.leftKey
			const rightKey = def.through.rightKey
			const links = await new QueryBuilder<any>(join).whereIn(leftKey, ids).all()
			const rightIds = links.map((l:any) => l[rightKey])
			const rights = rightIds.length ? await new QueryBuilder<any>(def.table).whereIn('id', rightIds).all() : []
			const rightById = new Map<any, any>(rights.map((x:any) => [x.id, x]))
			const bucket = new Map<any, any[]>()
			for (const l of links) {
				const arr = bucket.get(l[leftKey]) || []
				const item = rightById.get(l[rightKey])
				if (item) arr.push(item)
				bucket.set(l[leftKey], arr)
			}
			for (const r of rows) r[def.name] = bucket.get(r.id) || []
		}
	}
	return rows
} 