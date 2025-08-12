---
id: oracle
title: Oracle
---

Visão geral

- Executor: `OracleExecutor` (driver `oracledb`).
- Assíncrono; compatível com `QueryBuilder.make()`.
- Converte `?` para `:1, :2, ...` automaticamente.

Instalação
```bash
npm install oracledb
```

Configuração
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { OracleExecutor } from 'iagate-querykit/adapters/oracle'

setDefaultExecutor(new OracleExecutor({
  user: 'scott',
  password: 'tiger',
  connectString: 'localhost/XEPDB1',
  poolMin: 0,
  poolMax: 10,
}))
```

Leituras (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .all()
```

Escritas (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- O adapter converte `?` para `:1, :2, ...` automaticamente.

Transações

Nota: o adapter usa `autoCommit: true`. Para transações multi‑statement, execute comandos de controle explicitamente.

Básico:
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('BEGIN', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['x@y.com'])
await exec.executeQuery('COMMIT', [])
```

SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN', [])
await exec.executeQuery('SAVEPOINT sp1', [])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
await exec.executeQuery('COMMIT', [])
```

Erro → rollback:
```ts
await exec.executeQuery('BEGIN', [])
try {
  await exec.executeQuery('INSERT INTO logs (payload) VALUES (?)', ['ok'])
  await exec.executeQuery('COMMIT', [])
} catch {
  await exec.executeQuery('ROLLBACK', [])
}
```

Dependências nativas

- `oracledb` exige bibliotecas nativas (Oracle Instant Client) instaladas no sistema.
- Verifique a documentação oficial para sua plataforma. 