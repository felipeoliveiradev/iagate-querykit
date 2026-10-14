/**
 * Throwaway-only database access for tests.
 *
 * Hard rule: never connect to an existing/real/company database.
 * Tests talk only to 127.0.0.1 / ::1 / localhost, with credentials we
 * invented for the CI service containers and docker-compose.test.yml.
 * Each suite creates a uniquely named database and drops it afterwards.
 *
 * Ambient POSTGRES_*, MYSQL_*, DATABASE_URL, and any other host/secret
 * env vars are ignored on purpose.
 */

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

/** Credentials baked into our throwaway CI / compose services. Not read from the environment. */
export const THROWAWAY = {
  host: '127.0.0.1',
  user: 'querykit',
  password: 'querykit',
  postgresPort: 5432,
  mysqlPort: 3306,
} as const;

export function assertLoopbackHost(host: string): string {
  const raw = String(host || '').trim().toLowerCase();
  const h = raw.replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.has(h)) {
    throw new Error(
      `Refusing to connect to '${host}'. Tests may only use a throwaway loopback database (127.0.0.1 / localhost / ::1).`,
    );
  }
  return '127.0.0.1';
}

export function assertNoRemoteConnectionString(value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) return;
  const trimmed = value.trim();
  const withUser = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/[^@/?#]*@([^:/?#]+)/i);
  const bare = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/([^:/?#]+)/i);
  const host = withUser?.[1] || bare?.[1];
  if (host) assertLoopbackHost(host);
}

function ephemeralName(): string {
  return `qk_e_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
}

export type EphemeralHandle<T> = {
  exec: T;
  database: string;
  destroy(): Promise<void>;
};

export async function openEphemeralPostgres(): Promise<
  EphemeralHandle<import('../../adapters/postgresql.js').PostgresExecutor>
> {
  const { PostgresExecutor } = await import('../../adapters/postgresql.js');
  const host = assertLoopbackHost(THROWAWAY.host);
  const admin = new PostgresExecutor({
    host,
    port: THROWAWAY.postgresPort,
    user: THROWAWAY.user,
    password: THROWAWAY.password,
    database: 'querykit',
  });
  const database = ephemeralName();
  try {
    await admin.executeQuery(`CREATE DATABASE ${database}`, []);
  } catch (err) {
    await admin.close().catch(() => undefined);
    throw new Error(
      `No throwaway Postgres on 127.0.0.1:${THROWAWAY.postgresPort}. Start docker compose -f docker-compose.test.yml up -d (or the local test cluster). ${(err as Error).message}`,
    );
  }
  await admin.close();
  const exec = new PostgresExecutor({
    host,
    port: THROWAWAY.postgresPort,
    user: THROWAWAY.user,
    password: THROWAWAY.password,
    database,
  });
  return {
    exec,
    database,
    async destroy() {
      await exec.close().catch(() => undefined);
      const dropper = new PostgresExecutor({
        host,
        port: THROWAWAY.postgresPort,
        user: THROWAWAY.user,
        password: THROWAWAY.password,
        database: 'querykit',
      });
      try {
        await dropper.executeQuery(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`, []);
      } finally {
        await dropper.close().catch(() => undefined);
      }
    },
  };
}

export async function openEphemeralMysql(): Promise<
  EphemeralHandle<import('../../adapters/mysql.js').MysqlExecutor>
> {
  const { MysqlExecutor } = await import('../../adapters/mysql.js');
  const host = assertLoopbackHost(THROWAWAY.host);
  const database = ephemeralName();

  const tryCreate = async (user: string, password: string) => {
    const admin = new MysqlExecutor({ host, port: THROWAWAY.mysqlPort, user, password });
    try {
      await admin.executeQuery(`CREATE DATABASE \`${database}\``, []);
      await admin
        .executeQuery(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${THROWAWAY.user}'@'%'`, [])
        .catch(() => undefined);
      await admin
        .executeQuery(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${THROWAWAY.user}'@'localhost'`, [])
        .catch(() => undefined);
      return admin;
    } catch (err) {
      await admin.close().catch(() => undefined);
      throw err;
    }
  };

  let admin: import('../../adapters/mysql.js').MysqlExecutor;
  try {
    admin = await tryCreate(THROWAWAY.user, THROWAWAY.password);
  } catch {
    try {
      // Root password is the one we set on the throwaway compose / CI service (not a company secret).
      admin = await tryCreate('root', THROWAWAY.password);
    } catch (err) {
      throw new Error(
        `No throwaway MySQL on 127.0.0.1:${THROWAWAY.mysqlPort}. Start docker compose -f docker-compose.test.yml up -d (or the local test cluster). ${(err as Error).message}`,
      );
    }
  }
  await admin.close();

  const exec = new MysqlExecutor({
    host,
    port: THROWAWAY.mysqlPort,
    user: THROWAWAY.user,
    password: THROWAWAY.password,
    database,
  });
  return {
    exec,
    database,
    async destroy() {
      await exec.close().catch(() => undefined);
      const dropAs = async (user: string, password: string) => {
        const dropper = new MysqlExecutor({ host, port: THROWAWAY.mysqlPort, user, password });
        try {
          await dropper.executeQuery(`DROP DATABASE IF EXISTS \`${database}\``, []);
        } finally {
          await dropper.close().catch(() => undefined);
        }
      };
      try {
        await dropAs(THROWAWAY.user, THROWAWAY.password);
      } catch {
        await dropAs('root', THROWAWAY.password);
      }
    },
  };
}

/** Credentials invented for throwaway Oracle / SQL Server containers. Not env-sourced. */
export const THROWAWAY_MSSQL = {
  host: '127.0.0.1',
  port: 1433,
  user: 'sa',
  password: 'QueryKit_123',
} as const;

export const THROWAWAY_ORACLE = {
  host: '127.0.0.1',
  port: 1521,
  user: 'querykit',
  password: 'QueryKit123',
  connectString: '127.0.0.1:1521/FREEPDB1',
} as const;

export async function tryOpenEphemeralMssql(): Promise<
  | EphemeralHandle<import('../../adapters/sqlserver.js').SqlServerExecutor>
  | { skipped: true; reason: string }
> {
  const { SqlServerExecutor } = await import('../../adapters/sqlserver.js');
  const host = assertLoopbackHost(THROWAWAY_MSSQL.host);
  const admin = new SqlServerExecutor({
    user: THROWAWAY_MSSQL.user,
    password: THROWAWAY_MSSQL.password,
    server: host,
    port: THROWAWAY_MSSQL.port,
    database: 'master',
    options: { trustServerCertificate: true, encrypt: false },
    pool: { max: 2, min: 0 },
  });
  const database = ephemeralName();
  try {
    await admin.executeQuery(`CREATE DATABASE [${database}]`, []);
  } catch (err) {
    await admin.close().catch(() => undefined);
    return {
      skipped: true,
      reason: `No throwaway SQL Server on 127.0.0.1:${THROWAWAY_MSSQL.port}. ${(err as Error).message}`,
    };
  }
  await admin.close();
  const exec = new SqlServerExecutor({
    user: THROWAWAY_MSSQL.user,
    password: THROWAWAY_MSSQL.password,
    server: host,
    port: THROWAWAY_MSSQL.port,
    database,
    options: { trustServerCertificate: true, encrypt: false },
    pool: { max: 4, min: 0 },
  });
  return {
    exec,
    database,
    async destroy() {
      await exec.close().catch(() => undefined);
      const dropper = new SqlServerExecutor({
        user: THROWAWAY_MSSQL.user,
        password: THROWAWAY_MSSQL.password,
        server: host,
        port: THROWAWAY_MSSQL.port,
        database: 'master',
        options: { trustServerCertificate: true, encrypt: false },
      });
      try {
        await dropper.executeQuery(
          `ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`,
          [],
        );
      } finally {
        await dropper.close().catch(() => undefined);
      }
    },
  };
}

export async function tryOpenEphemeralOracle(): Promise<
  | EphemeralHandle<import('../../adapters/oracle.js').OracleExecutor>
  | { skipped: true; reason: string }
> {
  const { OracleExecutor } = await import('../../adapters/oracle.js');
  assertLoopbackHost(THROWAWAY_ORACLE.host);
  const exec = new OracleExecutor({
    user: THROWAWAY_ORACLE.user,
    password: THROWAWAY_ORACLE.password,
    connectString: THROWAWAY_ORACLE.connectString,
    poolMin: 0,
    poolMax: 2,
  });
  const database = ephemeralName();
  try {
    await exec.executeQuery(
      `BEGIN EXECUTE IMMEDIATE 'CREATE TABLE "${database}" ("id" NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "email" VARCHAR2(200), "body" CLOB, "blob_col" BLOB, "meta" CLOB, "n_val" NUMBER, "created_at" TIMESTAMP)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;`,
      [],
    );
  } catch (err) {
    await exec.close().catch(() => undefined);
    return {
      skipped: true,
      reason: `No throwaway Oracle on 127.0.0.1:${THROWAWAY_ORACLE.port}. ${(err as Error).message}`,
    };
  }
  return {
    exec,
    database,
    async destroy() {
      try {
        await exec.executeQuery(
          `BEGIN EXECUTE IMMEDIATE 'DROP TABLE "${database}"'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
          [],
        );
      } finally {
        await exec.close().catch(() => undefined);
      }
    },
  };
}
