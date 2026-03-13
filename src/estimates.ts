import { basename } from "node:path"
import { getBaselinePath, loadBaseline } from "./baseline"
import type { BaselineFile, BaselineMetric, BaselineSuiteData } from "./types"

export interface TokenEstimate {
  input: number | null
  output: number | null
  total: number | null
}

export interface SuiteEstimate {
  key: string
  label: string
  workMs: number | null
  wallMs: number | null
  testCount: number | null
  tokens: TokenEstimate
}

export interface EvalEstimate {
  evalFile: string
  baselinePath: string
  baselineUpdatedAt: string | null
  hasBaseline: boolean
  hasDetailedSuites: boolean
  suites: SuiteEstimate[]
  workMs: number | null
  wallLowerBoundMs: number | null
  wallUpperBoundMs: number | null
  testCount: number | null
  tokens: TokenEstimate
}

export interface EstimateSummary {
  selectedCount: number
  estimatedCount: number
  missingCount: number
  workMs: number | null
  wallLowerBoundMs: number | null
  wallUpperBoundMs: number | null
  tokens: TokenEstimate
}

type AggregateRecord = Record<string, BaselineMetric | number>

function metricValue(metric: BaselineMetric | number | undefined): number | null {
  if (typeof metric === "number") {
    return Number.isFinite(metric) ? metric : null
  }

  if (
    metric &&
    typeof metric === "object" &&
    "value" in metric &&
    typeof metric.value === "number" &&
    Number.isFinite(metric.value)
  ) {
    return metric.value
  }

  return null
}

function sumNumbers(values: Array<number | null | undefined>): number | null {
  let total = 0
  let hasValue = false

  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue
    }

    total += value
    hasValue = true
  }

  return hasValue ? total : null
}

function maxNumbers(values: Array<number | null | undefined>): number | null {
  let result = Number.NEGATIVE_INFINITY
  let hasValue = false

  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue
    }

    result = Math.max(result, value)
    hasValue = true
  }

  return hasValue ? result : null
}

function suiteWorkMs(aggregate: AggregateRecord): number | null {
  return (
    metricValue(aggregate["latency.total.sum"]) ??
    metricValue(aggregate["latency.sum"])
  )
}

function suiteWallMs(aggregate: AggregateRecord): number | null {
  return (
    metricValue(aggregate["latency.total.max"]) ??
    metricValue(aggregate["latency.max"]) ??
    metricValue(aggregate["latency.total.p95"]) ??
    metricValue(aggregate["latency.p95"]) ??
    metricValue(aggregate["latency.total.avg"]) ??
    metricValue(aggregate["latency.avg"]) ??
    suiteWorkMs(aggregate)
  )
}

function tokenEstimate(aggregate: AggregateRecord): TokenEstimate {
  const input = sumNumbers([
    metricValue(aggregate["tokens.input.sum"]),
    metricValue(aggregate["tokens.scorer.input.sum"]),
  ])
  const output = sumNumbers([
    metricValue(aggregate["tokens.output.sum"]),
    metricValue(aggregate["tokens.scorer.output.sum"]),
  ])
  const total =
    sumNumbers([
      metricValue(aggregate["tokens.total.sum"]),
      metricValue(aggregate["tokens.scorer.total.sum"]),
    ]) ?? sumNumbers([input, output])

  return {
    input,
    output,
    total,
  }
}

function buildSuiteEstimate(
  key: string,
  label: string,
  aggregate: AggregateRecord,
): SuiteEstimate {
  return {
    key,
    label,
    workMs: suiteWorkMs(aggregate),
    wallMs: suiteWallMs(aggregate),
    testCount: metricValue(aggregate["test.count"]),
    tokens: tokenEstimate(aggregate),
  }
}

function buildSuiteEstimates(
  evalFile: string,
  baseline: BaselineFile,
): SuiteEstimate[] {
  const suites = baseline._suites ? Object.entries(baseline._suites) : []

  if (suites.length > 0) {
    return suites.map(([suiteKey, suiteData]) =>
      buildSuiteEstimate(suiteKey, suiteKey, suiteData._aggregate),
    )
  }

  return [
    buildSuiteEstimate(basename(evalFile), basename(evalFile), baseline._aggregate),
  ]
}

function sumTokenEstimates(estimates: TokenEstimate[]): TokenEstimate {
  return {
    input: sumNumbers(estimates.map((estimate) => estimate.input)),
    output: sumNumbers(estimates.map((estimate) => estimate.output)),
    total: sumNumbers(estimates.map((estimate) => estimate.total)),
  }
}

function hasDetailedSuites(baseline: BaselineFile): boolean {
  return Boolean(baseline._suites && Object.keys(baseline._suites).length > 0)
}

export function buildEvalEstimate(
  evalFile: string,
  baseline: BaselineFile | null,
): EvalEstimate {
  const baselinePath = getBaselinePath(evalFile)

  if (!baseline) {
    return {
      evalFile,
      baselinePath,
      baselineUpdatedAt: null,
      hasBaseline: false,
      hasDetailedSuites: false,
      suites: [],
      workMs: null,
      wallLowerBoundMs: null,
      wallUpperBoundMs: null,
      testCount: null,
      tokens: {
        input: null,
        output: null,
        total: null,
      },
    }
  }

  const suites = buildSuiteEstimates(evalFile, baseline)
  const suiteWallMs = suites.map((suite) => suite.wallMs)

  return {
    evalFile,
    baselinePath,
    baselineUpdatedAt: baseline._meta.updatedAt,
    hasBaseline: true,
    hasDetailedSuites: hasDetailedSuites(baseline),
    suites,
    workMs: sumNumbers(suites.map((suite) => suite.workMs)),
    wallLowerBoundMs: maxNumbers(suiteWallMs),
    wallUpperBoundMs: sumNumbers(suiteWallMs),
    testCount: sumNumbers(suites.map((suite) => suite.testCount)),
    tokens: sumTokenEstimates(suites.map((suite) => suite.tokens)),
  }
}

export function loadEvalEstimate(evalFile: string): EvalEstimate {
  return buildEvalEstimate(evalFile, loadBaseline(evalFile))
}

export function loadEvalEstimates(evalFiles: string[]): EvalEstimate[] {
  return evalFiles.map(loadEvalEstimate)
}

export function summarizeEvalEstimates(
  estimates: EvalEstimate[],
): EstimateSummary {
  const estimated = estimates.filter((estimate) => estimate.hasBaseline)

  return {
    selectedCount: estimates.length,
    estimatedCount: estimated.length,
    missingCount: estimates.length - estimated.length,
    workMs: sumNumbers(estimated.map((estimate) => estimate.workMs)),
    wallLowerBoundMs: sumNumbers(
      estimated.map((estimate) => estimate.wallLowerBoundMs),
    ),
    wallUpperBoundMs: sumNumbers(
      estimated.map((estimate) => estimate.wallUpperBoundMs),
    ),
    tokens: sumTokenEstimates(estimated.map((estimate) => estimate.tokens)),
  }
}
