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

export class DriverError extends QueryKitError {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, 'DRIVER');
    this.cause = cause;
  }
}
