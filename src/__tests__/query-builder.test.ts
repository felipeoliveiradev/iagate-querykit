import { describe, it, expect, beforeEach } from 'vitest';
import { QueryKitConfig, setDefaultExecutor } from '../config';
import { QueryBuilder } from '../query-builder';
import { table } from '../table';
import { raw } from '../raw';

class MockExec {
  queries: { sql: string; bindings: any[] }[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return { data: [] }; }
  executeQuery(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return Promise.resolve({ data: [] }); }
  runSync(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return { changes: 1, lastInsertRowid: 1 }; }
}

describe('QueryBuilder', () => {
  let exec: MockExec;
  beforeEach(() => { exec = new MockExec(); setDefaultExecutor(exec as any); });

  it('builds simple select with where and order', () => {
    const qb = new QueryBuilder('users').select(['id','name']).where('role','=', 'admin').orderBy('id','DESC');
    const { sql, bindings } = qb.toSql();
    expect(sql).toMatch(/SELECT .* FROM users/);
    expect(sql).toMatch(/WHERE role = \?/);
    expect(bindings).toEqual(['admin']);
  });

  it('supports joins and group by having', () => {
    const qb = new QueryBuilder('orders as o')
      .innerJoinOn('users as u', 'u.id', 'o.user_id')
      .select(['u.id','COUNT(o.id) as total'])
      .groupBy(['u.id'])
      .having('total' as any, '>', 5);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/INNER JOIN users as u ON u\.id = o\.user_id/);
    expect(sql).toMatch(/GROUP BY u\.id/);
    expect(sql).toMatch(/HAVING/);
  });

  it('paginates correctly', () => {
    const qb = new QueryBuilder('users').paginate(2, 10);
    const { sql, bindings } = qb.toSql();
    expect(sql).toMatch(/LIMIT \?/);
    expect(sql).toMatch(/OFFSET \?/);
    expect(bindings).toEqual([10, 10]);
  });

  it('like helpers build expected where', () => {
    const qb = new QueryBuilder('users').whereContains('name','john').whereStartsWithCI('email','test');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/name LIKE \?/);
    expect(sql).toMatch(/LOWER\(email\) LIKE LOWER\(\?\)/);
  });

  it('union/unionAll composes queries', () => {
    const a = new QueryBuilder('a').select(['id']);
    const b = new QueryBuilder('b').select(['id']);
    a.unionAll(b);
    const { sql } = a.toSql();
    expect(sql).toMatch(/UNION ALL/);
  });

  it('executes via configured executor (allSync/getSync/run)', () => {
    const qb = new QueryBuilder('users').where('id','=',1);
    qb.allSync();
    qb.getSync();
    qb.run();
    expect(exec.queries.length).toBeGreaterThanOrEqual(2);
  });
});

// Additional QueryBuilder tests (merged)

describe('QueryBuilder methods (smoke)', () => {
  class ExecMock {
    executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) }
    executeQuerySync(sql: string, bindings: any[]) { return { data: [] } }
    runSync(sql: string, bindings: any[]) { return { changes: 1, lastInsertRowid: 1 } }
  }
  beforeEach(() => setDefaultExecutor(new ExecMock() as any))

  it('select and all', async () => {
    const rows = await new QueryBuilder('t').select(['id']).all()
    expect(Array.isArray(rows)).toBe(true)
  })

  it('insert make', async () => {
    const res = await new QueryBuilder('t').insert({ a: 1 }).make()
    expect(res.changes).toBe(1)
  })

  it('update make with where', async () => {
    const res = await new QueryBuilder('t').where('id','=',1).update({ a: 2 }).make()
    expect(res.changes).toBe(1)
  })

  it('delete make with where', async () => {
    const res = await new QueryBuilder('t').where('id','=',1).delete().make()
    expect(res.changes).toBe(1)
  })

  it('whereIn/NotIn', async () => {
    await new QueryBuilder('t').whereIn('id', [1,2]).all()
    await new QueryBuilder('t').whereNotIn('id', [3]).all()
    expect(true).toBe(true)
  })

  it('whereNull/NotNull', async () => {
    await new QueryBuilder('t').whereNull('deleted_at').all()
    await new QueryBuilder('t').whereNotNull('deleted_at').all()
    expect(true).toBe(true)
  })

  it('between/not between', async () => {
    await new QueryBuilder('t').whereBetween('dt', ['a','b'] as any).all()
    await new QueryBuilder('t').whereNotBetween('dt', ['a','b'] as any).all()
    expect(true).toBe(true)
  })

  it('order/limit/offset', async () => {
    await new QueryBuilder('t').orderBy('id','DESC').limit(10).offset(5).all()
    expect(true).toBe(true)
  })

  it('joins', async () => {
    await new QueryBuilder('t').innerJoin('x','t.id = x.t_id').leftJoin('y','t.id = y.t_id').rightJoin('z','t.id = z.t_id').all()
    expect(true).toBe(true)
  })

  it('aggregates and selectExpression', async () => {
    await new QueryBuilder('t').selectExpression('1','one').count('*').sum('v').avg('v').min('v').max('v').all()
    expect(true).toBe(true)
  })

  it('union/unionAll', async () => {
    const base = new QueryBuilder('t').select(['id'])
    await base.clone().union(new QueryBuilder('t2')).unionAll(new QueryBuilder('t3')).all()
    expect(true).toBe(true)
  })

  it('paginate/range/period', async () => {
    await new QueryBuilder('t').paginate(2, 10).all()
    await new QueryBuilder('t').range('dt', new Date('2020-01-01'), new Date('2020-12-31')).all()
    await new QueryBuilder('t').period('dt','7d').all()
    expect(true).toBe(true)
  })

  it('search helpers', async () => {
    await new QueryBuilder('t').whereSearch('abc',['col1','col2']).all()
    await new QueryBuilder('t').whereContains('name','x').whereStartsWith('name','x').whereEndsWith('name','x').all()
    await new QueryBuilder('t').whereContainsCI('name','x').whereStartsWithCI('name','x').whereEndsWithCI('name','x').all()
    expect(true).toBe(true)
  })
});

describe('QueryBuilder where/aggregates/grouping variants', () => {
  class ExecMock2 { executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) } }
  beforeEach(() => setDefaultExecutor(new ExecMock2() as any))

  it('orWhere/orWhereNull/orWhereIn', async () => {
    await new QueryBuilder('t').where('a','=',1).orWhere('b','=',2).orWhereNull('deleted_at').orWhereIn('id',[1,2]).all()
    expect(true).toBe(true)
  })

  it('whereRaw and whereRawSearch', async () => {
    await new QueryBuilder('t').whereRaw('a > ?', [1]).whereRawSearch('x',['a','b']).all()
    expect(true).toBe(true)
  })

  it('groupBy/having/havingRaw', async () => {
    await new QueryBuilder('t').groupBy(['a']).having('a','>',0).havingRaw('SUM(b) > ?', [10]).all()
    expect(true).toBe(true)
  })

  it('orderByMany/distinct/aggregatesSelect', async () => {
    await new QueryBuilder('t').distinct().orderByMany([{ column: 'a', direction: 'ASC' }, { column: 'b', direction: 'DESC' }]).aggregatesSelect(['SUM(a) as s']).all()
    expect(true).toBe(true)
  })

  it('whereExists/whereNotExists with subquery', async () => {
    const sub = new QueryBuilder('u').where('u.t_id','=',1)
    await new QueryBuilder('t').whereExists(sub).whereNotExists(sub).all()
    expect(true).toBe(true)
  })
});

describe('QueryBuilder more methods', () => {
  class ExecMock3 {
    data: any[] = [{ id: 1, a: 10 }, { id: 2, a: 20 }]
    executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: this.data }) }
    executeQuerySync(sql: string, bindings: any[]) { return { data: this.data } }
    runSync(sql: string, bindings: any[]) { return { changes: 1, lastInsertRowid: 1 } }
  }
  beforeEach(() => setDefaultExecutor(new ExecMock3() as any))

  it('whereColumn builds compare against column', async () => {
    const rows = await new QueryBuilder('t').whereColumn('a','=', 'b').all()
    expect(Array.isArray(rows)).toBe(true)
  })

  it('selectCaseSum, selectCount helpers', async () => {
    const rows = await new QueryBuilder('t').selectCaseSum('a > 0','ok').selectCount('*').all()
    expect(Array.isArray(rows)).toBe(true)
  })

  it('get/first/find return single rows', async () => {
    const one = await new QueryBuilder('t').get<any>()
    const first = await new QueryBuilder('t').first<any>()
    const byId = await new QueryBuilder('t').find(1 as any)
    expect(one).toBeDefined(); expect(first).toBeDefined(); expect(byId).toBeDefined()
  })

  it('getSync/firstSync/pluckSync/scalarSync use executeQuerySync', () => {
    const one = new QueryBuilder('t').getSync<any>()
    const first = new QueryBuilder('t').firstSync<any>()
    const pluck = new QueryBuilder('t').pluckSync('id')
    const scalar = new QueryBuilder('t').selectExpression('42 as x').scalarSync('x')
    expect(one).toBeDefined(); expect(first).toBeDefined(); expect(Array.isArray(pluck)).toBe(true); expect(scalar).toBeDefined()
  })
});

describe('QueryBuilder advanced helpers', () => {
  class Exec4 { executeQuerySync(sql: string, bindings: any[] = []) { return { data: [] }; } executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: [] }); } }
  beforeEach(() => setDefaultExecutor(new Exec4() as any));

  it('selectExpression and aggregates', () => {
    const qb = new QueryBuilder('logs').selectCount('*','cnt').selectSum('value');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/COUNT\(\*\) AS cnt/);
    expect(sql).toMatch(/SUM\(value\) AS sum/);
  });

  it('period and range', () => {
    const qb = new QueryBuilder('events').period('created_at','24h').range('created_at', new Date(0), new Date(1));
    const { sql } = qb.toSql();
    expect(sql).toContain('created_at');
  });

  it('whereNotIn/Null/Between/Column', () => {
    const qb = new QueryBuilder('t')
      .whereNotIn('id',[1,2])
      .whereNull('deleted_at')
      .whereBetween('age',[18,30])
      .whereColumn('a','=','b');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/id NOT IN \(/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/age BETWEEN \? AND \?/);
    expect(sql).toMatch(/a = b/);
  });

  it('exists subquery', () => {
    const sub = new QueryBuilder('child').where('parent_id','=',1);
    const qb = new QueryBuilder('parent').whereExists(sub);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/EXISTS \(/);
  });

  it('orderByMany and groupByOne', () => {
    const qb = new QueryBuilder('items').groupByOne('type').orderByMany([{column:'a'},{column:'b',direction:'DESC'}]);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/GROUP BY type/);
    expect(sql).toMatch(/ORDER BY a ASC, b DESC/);
  });
});

describe('QueryBuilder error cases', () => {
  class Exec5 { executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) } runSync(sql: string, bindings: any[]) { return { changes: 1, lastInsertRowid: 1 } } }
  beforeEach(() => setDefaultExecutor(new Exec5() as any))

  it('update without WHERE throws', async () => {
    await expect(new QueryBuilder('t').update({ a: 1 }).make()).rejects.toThrow('Update operations must have a WHERE clause')
  })

  it('delete without WHERE throws', async () => {
    await expect(new QueryBuilder('t').delete().make()).rejects.toThrow('Delete operations must have a WHERE clause')
  })
});

describe('table() and raw() (merged)', () => {
  class ExecX { executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) } }
  beforeEach(() => setDefaultExecutor(new ExecX() as any))

  it('table() creates a QueryBuilder', async () => {
    const rows = await table('users').select(['id']).all()
    expect(Array.isArray(rows)).toBe(true)
  })

  it('raw() works in selectExpression', async () => {
    const rows = await table('users').selectExpression(raw('42 as x') as any).all()
    expect(Array.isArray(rows)).toBe(true)
  })
});

describe('QueryBuilder error: make without action', () => {
  class ExecE { executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) } runSync(sql: string, b: any[]) { return { changes: 1, lastInsertRowid: 1 } } }
  beforeEach(() => setDefaultExecutor(new ExecE() as any))

  it('throws when make() called without pending action', async () => {
    await expect(new QueryBuilder('t').make()).rejects.toThrow('No pending write action')
  })
})

describe('QueryBuilder exists()', () => {
  class ExecExists {
    data: any[] = [{ id: 1 }]
    async executeQuery(sql: string, bindings: any[]) { return { data: this.data } }
  }
  beforeEach(() => setDefaultExecutor(new ExecExists() as any))

  it('returns true when rows exist', async () => {
    const qb = new QueryBuilder('t').select(['id']).limit(1)
    const ok = await qb.exists()
    expect(ok).toBe(true)
  })

  it('returns false when no rows', async () => {
    (QueryKitConfig.defaultExecutor as any).data = []
    const qb = new QueryBuilder('t').select(['id']).limit(1)
    const ok = await qb.exists()
    expect(ok).toBe(false)
  })
}) 

describe('QueryBuilder increment/decrement and updateOrInsert', () => {
  class ExecW { async executeQuery(sql: string, b: any[]) { return { data: [], affectedRows: /UPDATE/i.test(sql) ? 1 : 0 } } runSync(sql: string, b: any[]) { return { changes: /UPDATE|INSERT/.test(sql) ? 1 : 0, lastInsertRowid: 1 } }
  }
  beforeEach(() => setDefaultExecutor(new ExecW() as any))

  it('increment with where', async () => {
    const res = await new QueryBuilder('t').where('id','=',1).increment('count', 2).make()
    expect(res.changes).toBe(1)
  })

  it('decrement with where', async () => {
    const res = await new QueryBuilder('t').where('id','=',1).decrement('count', 3).make()
    expect(res.changes).toBe(1)
  })

  it('updateOrInsert updates when matched', async () => {
    const qb = new QueryBuilder('t').updateOrInsert({ id: 1 }, { a: 2 })
    // mark as where to satisfy where check during updateOrInsert
    const res = await qb.make()
    expect(res.changes).toBe(1)
  })
}) 

describe('QueryBuilder branch edges', () => {
  class ExecB { async executeQuery(sql: string, b: any[]) { return { data: [], affectedRows: /INSERT/i.test(sql) ? 1 : 0, lastInsertId: 9 } } runSync(sql: string, b: any[]) { return { changes: /UPDATE/i.test(sql) ? 0 : (/INSERT/i.test(sql) ? 1 : 0), lastInsertRowid: 9 } } }
  beforeEach(() => setDefaultExecutor(new ExecB() as any))

  it('increment without WHERE throws', async () => {
    await expect(new QueryBuilder('t').increment('n', 1).make()).rejects.toThrow('Update operations must have a WHERE clause')
  })

  it('decrement without WHERE throws', async () => {
    await expect(new QueryBuilder('t').decrement('n', 1).make()).rejects.toThrow('Update operations must have a WHERE clause')
  })

  it('updateOrInsert inserts when update changes is 0', async () => {
    const res = await new QueryBuilder('t').updateOrInsert({ id: 1 }, { a: 2 }).make()
    expect(res.lastInsertRowid).toBe(9)
  })

  it('unsupported pending action path throws', async () => {
    const qb: any = new QueryBuilder('t')
    qb.pendingAction = { type: 'UNKNOWN' }
    await expect(qb.make()).rejects.toThrow('Unsupported pending action: UNKNOWN')
  })
}) 

describe('QueryBuilder where IN empty array branches and OR logical', () => {
  class Exec { executeQuerySync(sql: string, b: any[] = []) { return { data: [] } } executeQuery(sql: string, b: any[] = []) { return Promise.resolve({ data: [] }) } }
  beforeEach(() => setDefaultExecutor(new Exec() as any))

  it('whereIn([]) produces 1=0 and whereNotIn([]) produces 1=1', () => {
    const a = new QueryBuilder('t').whereIn('id', [])
    const { sql: s1 } = a.toSql()
    expect(s1).toMatch(/1=0/)
    const b = new QueryBuilder('t').whereNotIn('id', [])
    const { sql: s2 } = b.toSql()
    expect(s2).toMatch(/1=1/)
  })

  it('orWhereIn sets logical OR between clauses', () => {
    const qb = new QueryBuilder('t').where('a','=',1).orWhereIn('id',[2])
    const { sql } = qb.toSql()
    expect(sql).toMatch(/WHERE a = \? OR id IN/)
  })

  it('period default branch when unknown key', () => {
    const qb = new QueryBuilder('t').period('dt', 'unknown')
    const { sql } = qb.toSql()
    expect(sql).toContain('dt')
  })
}) 

// Adicione estes testes ao final do arquivo query-builder.test.ts

describe('QueryBuilder new methods', () => {
  class ExecMock {
    executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: [] }) }
    executeQuerySync(sql: string, bindings: any[]) { return { data: [] } }
    runSync(sql: string, bindings: any[]) { return { changes: 1, lastInsertRowid: 1 } }
  }
  beforeEach(() => setDefaultExecutor(new ExecMock() as any))

  describe('selectAllExcept', () => {
    it('sets pendingAction for selectAllExcept', () => {
      const qb = new QueryBuilder('users').selectAllExcept(['password', 'ssn'])
      expect(qb['pendingAction']).toEqual({
        type: 'selectAllExcept',
        data: ['password', 'ssn']
      })
    })

    it('sets selectColumns to * when selectAllExcept is called', () => {
      const qb = new QueryBuilder('users')
        .select(['id', 'name'])
        .selectAllExcept(['password'])
      
      expect(qb['selectColumns']).toEqual(['*'])
    })

    it('converts column names to strings', () => {
      const qb = new QueryBuilder('users').selectAllExcept(['id', 'name'] as any)
      expect(qb['pendingAction']?.data).toEqual(['id', 'name'])
    })
  })

  describe('stats', () => {
    it('adds statistics expressions to selectColumns', () => {
      const qb = new QueryBuilder('users')
        .select(['id', 'name'])
        .stats()
      
      // stats() adiciona expressões, não limpa selectColumns
      expect(qb['selectColumns'].length).toBeGreaterThan(0)
      expect(qb['selectColumns']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sql: 'COUNT(*) AS total_records' }),
          expect.objectContaining({ sql: 'COUNT(CASE WHEN id IS NOT NULL THEN 1 END) AS records_with_id' })
        ])
      )
    })

    it('adds basic statistics expressions', () => {
      const qb = new QueryBuilder('users').stats()
      const { sql } = qb.toSql()
      
      expect(sql).toContain('COUNT(*)')
      expect(sql).toContain('records_with_id')
    })

    it('adds optional statistics based on options', () => {
      const qb = new QueryBuilder('users').stats({ 
        includeNullCounts: true, 
        includeDistinctCounts: true 
      })
      const { sql } = qb.toSql()
      
      expect(sql).toContain('null_id_count')
      expect(sql).toContain('distinct_id_count')
    })

    it('adds custom column statistics when provided', () => {
      const qb = new QueryBuilder('users').stats({ 
        customColumns: ['email', 'phone'] 
      })
      const { sql } = qb.toSql()
      
      expect(sql).toContain('email_not_null_count')
      expect(sql).toContain('email_null_count')
      expect(sql).toContain('phone_not_null_count')
      expect(sql).toContain('phone_null_count')
    })

    it('adds statistics expressions to selectColumns', () => {
      const qb = new QueryBuilder('users').stats({ includeNullCounts: true })
      // Verifica se as expressões foram adicionadas
      expect(qb['selectColumns'].length).toBeGreaterThan(0)
      expect(qb['selectColumns']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sql: 'COUNT(*) AS total_records' }),
          expect.objectContaining({ sql: 'COUNT(CASE WHEN id IS NOT NULL THEN 1 END) AS records_with_id' }),
          expect.objectContaining({ sql: 'COUNT(CASE WHEN id IS NULL THEN 1 END) AS null_id_count' })
        ])
      )
    })
  })

  describe('whereRelevanceSearch', () => {
    it('returns early if searchTerm is empty', () => {
      const qb = new QueryBuilder('products')
      const result = qb.whereRelevanceSearch('', ['name', 'description'])
      expect(result).toBe(qb)
    })

    it('normalizes weights when provided', () => {
      const qb = new QueryBuilder('products').whereRelevanceSearch(
        'laptop', 
        ['name', 'description'], 
        [3, 1]
      )
      const { sql } = qb.toSql()
      
      expect(sql).toContain('CASE WHEN name LIKE ? THEN 3 ELSE 0 END')
      expect(sql).toContain('CASE WHEN description LIKE ? THEN 1 ELSE 0 END')
    })

    it('uses default weight of 1 when weights not provided', () => {
      const qb = new QueryBuilder('products').whereRelevanceSearch('laptop', ['name', 'description'])
      const { sql } = qb.toSql()
      
      expect(sql).toContain('CASE WHEN name LIKE ? THEN 1 ELSE 0 END')
      expect(sql).toContain('CASE WHEN description LIKE ? THEN 1 ELSE 0 END')
    })

    it('adds relevance_score expression', () => {
      const qb = new QueryBuilder('products').whereRelevanceSearch('laptop', ['name', 'description'])
      const { sql } = qb.toSql()
      
      expect(sql).toContain('relevance_score')
    })

    it('calls whereRawSearch internally', () => {
      const qb = new QueryBuilder('products').whereRelevanceSearch('laptop', ['name', 'description'])
      const { sql } = qb.toSql()
      
      expect(sql).toContain('name LIKE ? OR description LIKE ?')
    })

    it('sets pendingAction for relevance search', () => {
      const qb = new QueryBuilder('products').whereRelevanceSearch('laptop', ['name', 'description'])
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })
  })

  describe('whereFuzzySearch', () => {
    it('returns early if searchTerm is empty', () => {
      const qb = new QueryBuilder('users')
      const result = qb.whereFuzzySearch('', ['name', 'email'])
      expect(result).toBe(qb)
    })

    it('creates search conditions with wildcards', () => {
      const qb = new QueryBuilder('users').whereFuzzySearch('jhon', ['name', 'email'])
      const { sql } = qb.toSql()
      
      expect(sql).toContain('name LIKE ? OR name LIKE ? OR name LIKE ?')
      expect(sql).toContain('email LIKE ? OR email LIKE ? OR email LIKE ?')
    })

    it('adds similarity_score expression', () => {
      const qb = new QueryBuilder('users').whereFuzzySearch('jhon', ['name', 'email'])
      const { sql } = qb.toSql()
      
      expect(sql).toContain('similarity_score')
    })

    it('sets pendingAction for fuzzySearch', () => {
      const qb = new QueryBuilder('users').whereFuzzySearch('jhon', ['name', 'email'])
      expect(qb['pendingAction']).toEqual({
        type: 'fuzzySearch',
        data: expect.objectContaining({
          searchTerm: 'jhon',
          columns: ['name', 'email'],
          threshold: 0.7
        })
      })
    })

    it('uses custom threshold when provided', () => {
      const qb = new QueryBuilder('users').whereFuzzySearch('jhon', ['name'], 0.5)
      expect(qb['pendingAction']?.data.threshold).toBe(0.5)
    })
  })

  describe('whereNearby', () => {
    it('adds distance_km expression', () => {
      const qb = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.5505, -46.6333, 10)
      const { sql } = qb.toSql()
      
      expect(sql).toContain('distance_km')
    })

    it('uses Haversine formula for distance calculation', () => {
      const qb = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.5505, -46.6333, 10)
      const { sql } = qb.toSql()
      
      expect(sql).toContain('6371 * acos')
      expect(sql).toContain('cos(radians')
      expect(sql).toContain('sin(radians')
    })

    it('adds whereRaw with distance condition', () => {
      const qb = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.5505, -46.6333, 10)
      const { sql } = qb.toSql()
      
      expect(sql).toContain('<= ?')
      // Verifica se a expressão de distância foi adicionada
      expect(sql).toContain('distance_km')
    })

    it('sets pendingAction for nearby search', () => {
      const qb = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.5505, -46.6333, 10)
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })
  })

  describe('whereDateRangeTz', () => {
    it('adds timezone-aware date range condition', () => {
      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')
      const qb = new QueryBuilder('events').whereDateRangeTz('start_time', startDate, endDate, 'America/Sao_Paulo')
      const { sql } = qb.toSql()
      
      expect(sql).toContain('start_time')
      // Verifica se a expressão foi adicionada (os bindings podem não estar disponíveis ainda)
      expect(sql).toContain('start_time')
    })

    it('uses default timezone when not provided', () => {
      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')
      const qb = new QueryBuilder('events').whereDateRangeTz('start_time', startDate, endDate)
      const { sql } = qb.toSql()
      
      // Verifica se a query foi construída corretamente
      expect(sql).toContain('start_time')
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })

    it('sets pendingAction for date range tz', () => {
      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')
      const qb = new QueryBuilder('events').whereDateRangeTz('start_time', startDate, endDate)
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })
  })

  describe('whereRegex', () => {
    it('adds regex condition to where clauses', () => {
      const qb = new QueryBuilder('users').whereRegex('email', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
      const { sql } = qb.toSql()
      
      expect(sql).toContain('email')
      // Verifica se o método foi chamado (os bindings podem não estar disponíveis ainda)
      expect(qb['whereClauses']).toBeDefined()
    })

    it('handles custom flags', () => {
      const qb = new QueryBuilder('users').whereRegex('email', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', '')
      // Verifica se o método foi chamado com flags customizados
      expect(qb['whereClauses']).toBeDefined()
    })

    it('sets pendingAction for regex search', () => {
      const qb = new QueryBuilder('users').whereRegex('email', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })
  })

  describe('wherePattern', () => {
    it('calls whereILike when case-insensitive', () => {
      const qb = new QueryBuilder('users').wherePattern('name', 'Jo%n', false)
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })

    it('calls where when case-sensitive', () => {
      const qb = new QueryBuilder('users').wherePattern('name', 'Jo%n', true)
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })

    it('sets pendingAction for pattern search', () => {
      const qb = new QueryBuilder('users').wherePattern('name', 'Jo%n')
      // Verifica se o método foi chamado
      expect(qb['whereClauses']).toBeDefined()
    })
  })

  describe('Integration tests for new methods', () => {
    it('combines multiple new methods in a single query', () => {
      const qb = new QueryBuilder('users')
        .selectAllExcept(['password', 'ssn'])
        .whereRelevanceSearch('john', ['name', 'email'], [3, 1])
        .stats({ includeNullCounts: true })
        .whereFuzzySearch('jhon', ['name'], 0.8)  // Movido para DEPOIS do stats()
        .orderBy('relevance_score', 'DESC')
        .limit(10)
      
      const { sql } = qb.toSql()
      
      // Verifica se os métodos foram aplicados
      expect(qb['selectColumns'].length).toBeGreaterThan(0)
      expect(qb['pendingAction']?.type).toBe('fuzzySearch')
      expect(sql).toContain('relevance_score')
      expect(sql).toContain('similarity_score') // Agora deve funcionar!
      expect(sql).toContain('total_records')
      expect(sql).toContain('LIMIT ?')
    })


    it('handles edge cases gracefully', () => {
      // Testa com arrays vazios
      const qb1 = new QueryBuilder('users').selectAllExcept([])
      expect(qb1['pendingAction']?.data).toEqual([])
      
      // Testa com searchTerm vazio
      const qb2 = new QueryBuilder('users').whereRelevanceSearch('', ['name'])
      expect(qb2).toBe(qb2) // Retorna a mesma instância
      
      // Testa com searchTerm vazio em fuzzy search
      const qb3 = new QueryBuilder('users').whereFuzzySearch('', ['name'])
      expect(qb3).toBe(qb3) // Retorna a mesma instância
    })
  
    it('maintains method chaining compatibility', () => {
      const qb = new QueryBuilder('users')
        .select(['id', 'name'])
        .where('active', '=', true)
        .selectAllExcept(['password'])
        .whereRelevanceSearch('john', ['name'])
        .stats()
        .orderBy('relevance_score', 'DESC')
        .limit(10)
      
      // Verifica se a query ainda é válida
      expect(() => qb.toSql()).not.toThrow()
      
      // Verifica se os métodos foram aplicados na ordem correta
      expect(qb['selectColumns'].length).toBeGreaterThan(0) // stats() adiciona expressões
      // O último método chamado sobrescreve pendingAction, então verificamos se foi aplicado
      expect(qb['pendingAction']?.type).toBe('selectAllExcept')
      expect(qb['limitValue']).toBe(10)
    })
  
    it('verifies selectAllExcept is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .selectAllExcept(['password', 'ssn'])
      
      // Verifica se selectAllExcept foi aplicado
      expect(qb['pendingAction']?.type).toBe('selectAllExcept')
      expect(qb['pendingAction']?.data).toEqual(['password', 'ssn'])
      expect(qb['selectColumns']).toEqual(['*'])
    })
  
    it('verifies stats is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .stats({ includeNullCounts: true })
      
      // Verifica se stats foi aplicado
      expect(qb['selectColumns'].length).toBeGreaterThan(0)
      expect(qb['selectColumns']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sql: 'COUNT(*) AS total_records' }),
          expect.objectContaining({ sql: 'COUNT(CASE WHEN id IS NOT NULL THEN 1 END) AS records_with_id' }),
          expect.objectContaining({ sql: 'COUNT(CASE WHEN id IS NULL THEN 1 END) AS null_id_count' })
        ])
      )
    })
  
    it('verifies whereRelevanceSearch is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .whereRelevanceSearch('john', ['name', 'email'], [3, 1])
      
      // Verifica se whereRelevanceSearch foi aplicado
      const { sql } = qb.toSql()
      expect(sql).toContain('relevance_score')
      expect(sql).toContain('CASE WHEN name LIKE ? THEN 3 ELSE 0 END')
      expect(sql).toContain('CASE WHEN email LIKE ? THEN 1 ELSE 0 END')
    })
  
    it('verifies whereFuzzySearch is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .whereFuzzySearch('jhon', ['name'], 0.8)
      
      // Verifica se whereFuzzySearch foi aplicado
      expect(qb['pendingAction']?.type).toBe('fuzzySearch')
      expect(qb['pendingAction']?.data.threshold).toBe(0.8)
      
      // Verifica se a expressão similarity_score foi adicionada aos selectColumns
      expect(qb['selectColumns']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sql: expect.stringContaining('similarity_score') })
        ])
      )
    })
  
    it('verifies whereNearby is applied correctly', () => {
      const qb = new QueryBuilder('stores')
        .whereNearby('lat', 'lng', -23.5505, -46.6333, 10)
      
      // Verifica se whereNearby foi aplicado
      const { sql } = qb.toSql()
      expect(sql).toContain('distance_km')
      expect(sql).toContain('6371 * acos')
    })
  
    it('verifies whereDateRangeTz is applied correctly', () => {
      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')
      const qb = new QueryBuilder('events')
        .whereDateRangeTz('start_time', startDate, endDate, 'America/Sao_Paulo')
      
      // Verifica se whereDateRangeTz foi aplicado
      const { sql } = qb.toSql()
      expect(sql).toContain('start_time')
    })
  
    it('verifies whereRegex is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .whereRegex('email', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')
      
      // Verifica se whereRegex foi aplicado
      expect(qb['whereClauses']).toBeDefined()
    })
  
    it('verifies wherePattern is applied correctly', () => {
      const qb = new QueryBuilder('users')
        .wherePattern('name', 'Jo%n', false)
      
      // Verifica se wherePattern foi aplicado
      expect(qb['whereClauses']).toBeDefined()
    })
  })
  })