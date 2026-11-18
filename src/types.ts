export type ScorerKind = "heuristic" | "judge";

export interface MetricRecord {
  name: string;
  value: number;
  unit?: string;
}

export interface ScorerInput<TInput = string, TOutput = string, TExpected = TOutput> {
  input: TInput;
  output: TOutput;
  expected?: TExpected;
}

export interface ScorerResult {
  score: number;
  name: string;
  description?: string;
  metadata?: unknown;
  kind?: ScorerKind;
}

export type Scorer<TInput = string, TOutput = string, TExpected = TOutput> = {
  name: string;
  description?: string;
  kind?: ScorerKind;
  scorer: (
    input: ScorerInput<TInput, TOutput, TExpected>,
  ) =>
    | number
    | { score: number; metadata?: unknown }
    | Promise<number | { score: number; metadata?: unknown }>;
};

export interface EvalData<TInput = string, TExpected = string> {
  name?: string;
  input: TInput;
  expected?: TExpected;
  weight?: number;
  only?: boolean;
}

export interface AggregationEntry {
  value: number;
  weight: number;
}

export interface SuiteConfig {
  passThreshold?: number;
  aggregations?: Record<string, (entries: AggregationEntry[]) => number>;
}

export interface EvalSuiteConfig<TInput = string, TOutput = string, TExpected = TOutput> {
  data:
    | EvalData<TInput, TExpected>[]
    | (() => EvalData<TInput, TExpected>[] | Promise<EvalData<TInput, TExpected>[]>);
  task: (input: TInput) => Promise<TOutput>;
  scorers?: Scorer<TInput, TOutput, TExpected>[];
  passThreshold?: number;
  aggregations?: Record<string, (entries: AggregationEntry[]) => number>;
  timeout?: number;
}

export interface MeasureContext {
  metric(name: string, value: number, unit?: string): void;
  score(name: string, value: number): void;
  tokens(usage: { promptTokens: number; completionTokens: number; totalTokens?: number }): void;
  weight(w: number): void;
  taskEnd(): void;
}

export interface MeasureResult<T> {
  result: T;
  metrics: Record<string, number | boolean>;
}

export interface TestMetrics {
  suiteKey: string;
  suiteName: string;
  testName: string;
  metrics: Record<string, number | boolean>;
  weight: number;
  passed: boolean;
  scorerResults: ScorerResult[];
  input?: unknown;
  output?: unknown;
  expected?: unknown;
  _phase?: "task" | "scoring";
}

export interface BaselineMetric {
  value: number;
  tolerance: number;
  direction?: "higher" | "lower";
}

export interface BaselineMeta {
  updatedAt: string;
  evalFile: string;
}

export interface BaselineSuiteData {
  _aggregate: Record<string, BaselineMetric | number>;
  [testName: string]: Record<string, BaselineMetric | number>;
}

export interface BaselineSuites {
  [suiteKey: string]: BaselineSuiteData;
}

export interface BaselineFile {
  _meta: BaselineMeta;
  _aggregate: Record<string, BaselineMetric | number>;
  _suites?: BaselineSuites;
  [testName: string]:
    | Record<string, BaselineMetric | number>
    | BaselineMeta
    | BaselineSuites
    | undefined;
}

export interface ComparisonResult {
  metric: string;
  current: number;
  baseline: number;
  tolerance: number;
  change: number;
  regressed: boolean;
  direction: "higher" | "lower";
}

export interface VerboseTestReport {
  testName: string;
  displayName: string;
  passed: boolean;
  metrics: Record<string, number>;
  scorerResults: ScorerResult[];
  input?: unknown;
  output?: unknown;
  expected?: unknown;
}

export interface SuiteReport {
  suiteName: string;
  testCount: number;
  passRate: number;
  passThreshold: number;
  aggregates: Record<string, number>;
  comparisons: ComparisonResult[];
  perTestComparisons: Record<string, ComparisonResult[]>;
  tests: VerboseTestReport[];
}

export interface TraceEntry {
  start: number;
  end: number;
  input: unknown;
  output: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}
