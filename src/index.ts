// @goodit/evals — Public API

export { Facts, isFactsCheck } from "./checks"
export type { FactsCheck } from "./checks"
export { collector } from "./collector"
export { evalSuite } from "./eval-suite"
export {
  createLLMJudgeScorer,
  MatchesIntent,
  SemanticContains,
  SemanticMatch,
  wrapAutoeval,
} from "./llm-scorer"
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
  ScorerKind,
  ScorerResult,
  SuiteConfig,
  SuiteReport,
  TestMetrics,
  TraceEntry,
} from "./types"
