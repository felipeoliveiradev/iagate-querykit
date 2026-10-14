/**
 * Typed errors for the public API. Driver/engine errors still propagate
 * with their original message; QueryKit throws these for its own checks.
 */
export class QueryKitError extends Error {
  readonly code: string;

  constructor(message: string, code = 'QUERYKIT') {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsafeIdentifierError extends QueryKitError {
  constructor(message: string) {
    super(message, 'UNSAFE_IDENTIFIER');
    this.name = 'UnsafeIdentifierError';
  }
}

export class BindError extends QueryKitError {
  constructor(message: string) {
    super(message, 'BIND');
  }
}

export class InsertError extends QueryKitError {
  constructor(message: string) {
    super(message, 'INSERT');
  }
}

export class TransactionError extends QueryKitError {
  constructor(message: string) {
    super(message, 'TRANSACTION');
  }
}

export type DriverErrorInit = {
  message: string;
  cause?: unknown;
  sql?: string;
  params?: unknown[];
  driverCode?: string;
  dialect?: string;
  code?: string;
};

export class DriverError extends QueryKitError {
  override readonly cause?: unknown;
  readonly sql?: string;
  readonly params?: unknown[];
  readonly driverCode?: string;
  readonly dialect?: string;

  constructor(messageOrInit: string | DriverErrorInit, cause?: unknown) {
    if (typeof messageOrInit === 'string') {
      super(messageOrInit, 'DRIVER');
      this.cause = cause;
    } else {
      super(messageOrInit.message, messageOrInit.code || 'DRIVER');
      this.cause = messageOrInit.cause;
      this.sql = messageOrInit.sql;
      this.params = messageOrInit.params;
      this.driverCode = messageOrInit.driverCode;
      this.dialect = messageOrInit.dialect;
    }
  }
}
