import { describe, it, expect } from 'vitest';
import {
  assertLoopbackHost,
  assertNoRemoteConnectionString,
  THROWAWAY,
} from './integration/ephemeral.js';

describe('ephemeral DB guard (never touch a real database)', () => {
  it('allows only loopback hosts', () => {
    expect(assertLoopbackHost('127.0.0.1')).toBe('127.0.0.1');
    expect(assertLoopbackHost('localhost')).toBe('127.0.0.1');
    expect(assertLoopbackHost('::1')).toBe('127.0.0.1');
    expect(assertLoopbackHost('[::1]')).toBe('127.0.0.1');
  });

  it('refuses company / public / LAN hosts and IPs', () => {
    for (const host of [
      'prod.internal.example.com',
      'db.company.com',
      'rds.amazonaws.com',
      '10.0.0.4',
      '192.168.1.10',
      '172.16.0.2',
      '8.8.8.8',
      'postgres.default.svc.cluster.local',
    ]) {
      expect(() => assertLoopbackHost(host)).toThrow(/throwaway loopback/);
    }
  });

  it('refuses remote connection strings', () => {
    expect(() =>
      assertNoRemoteConnectionString('postgres://app:secret@prod-db.internal:5432/app'),
    ).toThrow(/throwaway loopback/);
    expect(() =>
      assertNoRemoteConnectionString('mysql://user:pass@10.1.2.3:3306/app'),
    ).toThrow(/throwaway loopback/);
    expect(() =>
      assertNoRemoteConnectionString('postgres://querykit:querykit@127.0.0.1:5432/qk_e_1'),
    ).not.toThrow();
  });

  it('does not read ambient DATABASE_URL / POSTGRES_HOST / MYSQL_HOST', () => {
    expect(THROWAWAY.host).toBe('127.0.0.1');
    expect(THROWAWAY.user).toBe('querykit');
    expect(THROWAWAY.password).toBe('querykit');
    expect(THROWAWAY.host).not.toBe(process.env.DATABASE_URL);
    // Even if a leaked env pointed at prod, the helper still uses loopback throwaway creds.
    expect(THROWAWAY.host).toBe('127.0.0.1');
  });
});
