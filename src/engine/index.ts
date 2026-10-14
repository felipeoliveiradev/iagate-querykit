export type {
  Dialect,
  DialectCapabilities,
  SqlFragment,
  CatalogQuery,
  FullTextMode,
  FullTextOptions,
  ColumnTypeName,
  TypeMapper,
  ErrorMapper,
} from './dialect.js';
export { registerDialect, getDialect, tryGetDialect, listDialects, hasDialect } from './registry.js';
export { resolveEngine } from './resolve.js';
export {
  UnsupportedFeatureError,
  toDriverError,
  wrapDriverCall,
  wrapDriverSync,
  redactParams,
  normalizeDriverCode,
  type DriverErrorContext,
} from './errors.js';
export { hydrateInteger, hydrateRow, hydrateRows } from './hydrate.js';
export { runDialectConformance, type ConformanceAdapter } from './conformance.js';
export { splitIdent, wrapDouble, wrapBacktick, wrapBracket } from './idents.js';
export { defineDialect, likeFullText, limitOffsetPaging, fetchNextPaging, fallbackCatalogs } from '../dialects/define.js';
export { makeQuoter } from '../dialects/quoting.js';
