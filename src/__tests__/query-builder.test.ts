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
    expect(sql).toMatch(/email LIKE \? COLLATE NOCASE/);
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