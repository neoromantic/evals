import { afterAll } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { aggregateMetrics } from "./aggregate"
import {
  baselineTestEntryKey,
  compareMetrics,
  getBaselinePath,
  loadBaseline,
  resolveSuiteBaseline,
  saveBaseline,
  upsertSuiteBaseline,
} from "./baseline"
import { collector } from "./collector"
import {
  printSuiteReport,
  printSummary,
  printVariantComparisonTables,
} from "./reporter"
import type {
  BaselineSuiteData,
  ComparisonResult,
  SuiteReport,
  TestMetrics,
  VerboseTestReport,
} from "./types"

interface PreparedSuiteReport {
  suiteKey: string
  report: SuiteReport
  evalFile: string
  aggregates: Record<string, number>
  perTest: Record<string, Record<string, number>>
}

interface JsonSuiteResult {
  suiteKey: string
  suiteName: string
  evalFile: string
  testCount: number
  passRate: number
  passThreshold: number
  aggregates: Record<string, number>
  comparisons: ComparisonResult[]
  perTestComparisons: Record<string, ComparisonResult[]>
  perTest: Record<string, Record<string, number>>
  tests: VerboseTestReport[]
}

interface JsonVariantResult {
  suiteKey: string
  suiteName: string
  variantName: string
  aggregates: Record<string, number>
}

interface JsonVariantComparison {
  baseSuiteName: string
  variants: JsonVariantResult[]
}

interface JsonSummary {
  suiteCount: number
  hasBaseline: boolean
  regressions: number
  metricsOk: number
}

interface JsonRunPayload {
  generatedAt: string
  summary: JsonSummary
  suites: JsonSuiteResult[]
  variantComparisons: JsonVariantComparison[]
}

function parseEvalFiles(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function resolveEvalFileForSuite(
  mappedEvalFile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (mappedEvalFile) {
    return mappedEvalFile
  }

  if (env.EVAL_FILE) {
    return env.EVAL_FILE
  }

  const [fallbackEvalFile] = parseEvalFiles(env.EVAL_FILES)
  return fallbackEvalFile ?? ""
}

function uniqueTestRecordKey(
  testName: string,
  usedKeys: Set<string>,
  nextSuffixByName: Map<string, number>,
): string {
  if (!usedKeys.has(testName)) {
    usedKeys.add(testName)
    return testName
  }

  let suffix = nextSuffixByName.get(testName) ?? 2
  let candidate = `${testName} (#${suffix})`

  while (usedKeys.has(candidate)) {
    suffix += 1
    candidate = `${testName} (#${suffix})`
  }

  nextSuffixByName.set(testName, suffix + 1)
  usedKeys.add(candidate)
  return candidate
}

export function buildPerTestMetrics(
  tests: TestMetrics[],
): Record<string, Record<string, number>> {
  const perTest: Record<string, Record<string, number>> = {}
  const usedKeys: Set<string> = new Set()
  const nextSuffixByName: Map<string, number> = new Map()

  for (const test of tests) {
    const key = uniqueTestRecordKey(test.testName, usedKeys, nextSuffixByName)
    const numericMetrics: Record<string, number> = {}

    for (const [metricName, metricValue] of Object.entries(test.metrics)) {
      if (typeof metricValue === "number") {
        numericMetrics[metricName] = metricValue
      }
    }

    perTest[key] = numericMetrics
  }

  return perTest
}

function buildVerboseTests(tests: TestMetrics[]): VerboseTestReport[] {
  const usedKeys: Set<string> = new Set()
  const nextSuffixByName: Map<string, number> = new Map()

  return tests.map((test) => {
    const displayName = uniqueTestRecordKey(
      test.testName,
      usedKeys,
      nextSuffixByName,
    )
    const numericMetrics: Record<string, number> = {}

    for (const [metricName, metricValue] of Object.entries(test.metrics)) {
      if (typeof metricValue === "number") {
        numericMetrics[metricName] = metricValue
      }
    }

    return {
      testName: test.testName,
      displayName,
      passed: test.passed,
      metrics: numericMetrics,
      scorerResults: test.scorerResults,
      input: test.input,
      output: test.output,
      expected: test.expected,
    }
  })
}

function isVerboseReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EVAL_VERBOSE?.trim().toLowerCase()
  if (!value) {
    return false
  }

  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function isJsonReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EVAL_JSON?.trim().toLowerCase()
  if (!value) {
    return false
  }

  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function comparePerTestMetrics(
  perTest: Record<string, Record<string, number>>,
  baseline: BaselineSuiteData,
): Record<string, ComparisonResult[]> {
  const perTestComparisons: Record<string, ComparisonResult[]> = {}

  for (const [testName, metrics] of Object.entries(perTest)) {
    const baselineTest = baseline[baselineTestEntryKey(testName)]
    if (!baselineTest || typeof baselineTest !== "object") {
      continue
    }

    const testComparisons = compareMetrics(
      metrics,
      baselineTest as Record<
        string,
        { value: number; tolerance: number } | number
      >,
    )
    if (testComparisons.some((comparison) => comparison.regressed)) {
      perTestComparisons[testName] = testComparisons
    }
  }

  return perTestComparisons
}

function prepareSuiteReport(suiteKey: string): PreparedSuiteReport | null {
  const tests = collector.getTestResultsForSuite(suiteKey)
  if (tests.length === 0) {
    return null
  }

  const suiteName = collector.getSuiteName(suiteKey) ?? suiteKey
  const suiteConfig = collector.getSuiteConfig(suiteKey)
  const passThreshold = suiteConfig?.passThreshold ?? 0.5
  const aggregates = aggregateMetrics(tests, suiteConfig)
  const perTest = buildPerTestMetrics(tests)
  const verboseTests = buildVerboseTests(tests)
  const evalFile = resolveEvalFileForSuite(collector.getEvalFile(suiteKey))
  const baseline = evalFile ? loadBaseline(evalFile) : null
  const suiteBaseline = baseline
    ? resolveSuiteBaseline(baseline, suiteKey)
    : null

  const comparisons = suiteBaseline?._aggregate
    ? compareMetrics(aggregates, suiteBaseline._aggregate)
    : []
  const perTestComparisons = suiteBaseline
    ? comparePerTestMetrics(perTest, suiteBaseline)
    : {}
  const passRate = aggregates["test.pass_rate"] ?? 1.0

  return {
    suiteKey,
    report: {
      suiteName,
      testCount: tests.length,
      passRate,
      passThreshold,
      aggregates,
      comparisons,
      perTestComparisons,
      tests: verboseTests,
    },
    evalFile,
    aggregates,
    perTest,
  }
}

function updateBaselineIfRequested(
  suiteKey: string,
  evalFile: string,
  aggregates: Record<string, number>,
  perTest: Record<string, Record<string, number>>,
  options?: { silent?: boolean },
): void {
  if (process.env.UPDATE_BASELINE !== "1" || !evalFile) {
    return
  }

  const baselineData = upsertSuiteBaseline(
    evalFile,
    loadBaseline(evalFile),
    suiteKey,
    aggregates,
    perTest,
  )
  saveBaseline(evalFile, baselineData)
  if (!options?.silent) {
    console.log(`\n  Baseline updated: ${getBaselinePath(evalFile)}`)
  }
}

function saveRawOutputIfRequested(
  suiteKey: string,
  suiteName: string,
  aggregates: Record<string, number>,
  perTest: Record<string, Record<string, number>>,
): void {
  const outputPath = process.env.EVAL_OUTPUT
  if (!outputPath) {
    return
  }

  const existing = existsSync(outputPath)
    ? (JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>)
    : {}

  const payload = { suiteKey, suiteName, aggregates, perTest }
  existing[suiteKey] = payload
  const existingByName = existing[suiteName] as
    | { suiteKey?: string }
    | undefined
  if (!existingByName || existingByName.suiteKey === suiteKey) {
    existing[suiteName] = payload
  }
  writeFileSync(outputPath, JSON.stringify(existing, null, 2))
}

function buildJsonSummary(reports: SuiteReport[]): JsonSummary {
  let regressions = 0
  let metricsOk = 0
  let hasBaseline = false

  for (const report of reports) {
    if (report.comparisons.length > 0) {
      hasBaseline = true
    }

    for (const comparison of report.comparisons) {
      if (comparison.regressed) {
        regressions += 1
      } else {
        metricsOk += 1
      }
    }

    for (const perTestComparisons of Object.values(report.perTestComparisons)) {
      for (const comparison of perTestComparisons) {
        if (comparison.regressed) {
          regressions += 1
        } else {
          metricsOk += 1
        }
      }
    }
  }

  return {
    suiteCount: reports.length,
    hasBaseline,
    regressions,
    metricsOk,
  }
}

function buildVariantComparisons(
  suites: JsonSuiteResult[],
): JsonVariantComparison[] {
  const grouped = new Map<string, JsonVariantResult[]>()

  for (const suite of suites) {
    const variantIdentity = parseVariantIdentity(suite.suiteName)
    if (!variantIdentity) {
      continue
    }

    const variants = grouped.get(variantIdentity.baseSuiteName) ?? []
    variants.push({
      suiteKey: suite.suiteKey,
      suiteName: suite.suiteName,
      variantName: variantIdentity.variantName,
      aggregates: suite.aggregates,
    })
    grouped.set(variantIdentity.baseSuiteName, variants)
  }

  const comparisons: JsonVariantComparison[] = []
  for (const [baseSuiteName, variants] of grouped) {
    if (variants.length < 2) {
      continue
    }

    variants.sort((left, right) =>
      left.variantName.localeCompare(right.variantName),
    )
    comparisons.push({
      baseSuiteName,
      variants,
    })
  }

  comparisons.sort((left, right) =>
    left.baseSuiteName.localeCompare(right.baseSuiteName),
  )
  return comparisons
}

function parseVariantIdentity(
  suiteName: string,
): { baseSuiteName: string; variantName: string } | null {
  const match = suiteName.match(/^(.*)\s\[(.+)\]$/)
  const baseSuiteName = match?.[1]?.trim()
  const variantName = match?.[2]?.trim()

  if (!baseSuiteName || !variantName) {
    return null
  }

  return { baseSuiteName, variantName }
}

function buildJsonPayload(prepared: PreparedSuiteReport[]): JsonRunPayload {
  const suites: JsonSuiteResult[] = prepared.map((entry) => ({
    suiteKey: entry.suiteKey,
    suiteName: entry.report.suiteName,
    evalFile: entry.evalFile,
    testCount: entry.report.testCount,
    passRate: entry.report.passRate,
    passThreshold: entry.report.passThreshold,
    aggregates: entry.aggregates,
    comparisons: entry.report.comparisons,
    perTestComparisons: entry.report.perTestComparisons,
    perTest: entry.perTest,
    tests: entry.report.tests,
  }))
  const reports = prepared.map((entry) => entry.report)

  return {
    generatedAt: new Date().toISOString(),
    summary: buildJsonSummary(reports),
    suites,
    variantComparisons: buildVariantComparisons(suites),
  }
}

function writeJsonPayload(payload: JsonRunPayload): void {
  const outputPath = process.env.EVAL_JSON_OUTPUT_FILE
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(payload, null, 2))
    return
  }

  console.log(JSON.stringify(payload, null, 2))
}

afterAll(() => {
  const jsonReport = isJsonReportEnabled()
  const suiteKeys = collector.getSuiteKeys()
  if (suiteKeys.length === 0) {
    if (jsonReport) {
      writeJsonPayload(buildJsonPayload([]))
    }
    collector.reset()
    return
  }

  const reports: SuiteReport[] = []
  const preparedReports: PreparedSuiteReport[] = []
  const verboseReport = isVerboseReportEnabled()

  for (const suiteKey of suiteKeys) {
    const prepared = prepareSuiteReport(suiteKey)
    if (!prepared) {
      continue
    }

    preparedReports.push(prepared)
    reports.push(prepared.report)
    if (!jsonReport) {
      printSuiteReport(
        prepared.report,
        prepared.evalFile ? prepared.evalFile.split("/").pop() : undefined,
        {
          verbose: verboseReport,
        },
      )
    }
    updateBaselineIfRequested(
      prepared.suiteKey,
      prepared.evalFile,
      prepared.aggregates,
      prepared.perTest,
      { silent: jsonReport },
    )
    saveRawOutputIfRequested(
      prepared.suiteKey,
      prepared.report.suiteName,
      prepared.aggregates,
      prepared.perTest,
    )
  }

  if (jsonReport) {
    writeJsonPayload(buildJsonPayload(preparedReports))
  } else if (reports.length > 0) {
    printVariantComparisonTables(reports)
    printSummary(reports)
  }

  // Reset collector for next potential run
  collector.reset()
})
