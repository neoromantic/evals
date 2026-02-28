// @goodit/evals — Public API

export { collector } from "./collector"
export { evalSuite } from "./eval-suite"
export { measure, score, suite } from "./measure"
export {
  Contains,
  ContainsAll,
  ContainsAny,
  createScorer,
  ExactMatch,
  JsonMatch,
  LengthRatio,
  NumericCloseness,
} from "./scorer"
export { reportTrace, runWithTraces, traceModel } from "./trace"
export type {
  AggregationEntry,
  BaselineFile,
  BaselineMeta,
  BaselineMetric,
  ComparisonResult,
  EvalData,
  EvalSuiteConfig,
  MeasureContext,
  MeasureResult,
  Scorer,
  ScorerInput,
  ScorerResult,
  SuiteConfig,
  SuiteReport,
  TestMetrics,
  TraceEntry,
} from "./types"
