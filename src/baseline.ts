import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type {
  BaselineFile,
  BaselineMetric,
  BaselineSuiteData,
  BaselineSuites,
  ComparisonResult,
} from "./types"

const RESERVED_BASELINE_KEYS = new Set(["_meta", "_aggregate", "_suites"])
const BASELINE_TEST_KEY_ESCAPE_PREFIX = "@"

export function getBaselinePath(evalFilePath: string): string {
  const dir = dirname(evalFilePath)
  const name = basename(evalFilePath).replace(
    /\.eval\.\w+$/,
    ".eval.baseline.json",
  )
  return join(dir, name)
}

export function loadBaseline(evalFilePath: string): BaselineFile | null {
  const path = getBaselinePath(evalFilePath)
  if (!existsSync(path)) return null
  const raw = readFileSync(path, "utf-8")
  return JSON.parse(raw) as BaselineFile
}

export function saveBaseline(evalFilePath: string, data: BaselineFile): void {
  const path = getBaselinePath(evalFilePath)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8")
}

export function getDefaultTolerance(metricName: string): number {
  if (/^latency\b/.test(metricName) || /^ttfb(?:\.|$)/.test(metricName))
    return 0.2
  if (/^tokens\b/.test(metricName)) return 0.1
  if (/^score\b/.test(metricName)) return 0.05
  if (/^throughput\b/.test(metricName)) return 0.15
  if (/^error\b/.test(metricName)) return 0
  if (metricName === "test.pass_rate") return 0.05
  if (metricName === "test.count") return 0
  return 0.1
}

export function getMetricDirection(metricName: string): "higher" | "lower" {
  if (/^score\b/.test(metricName)) return "higher"
  if (/^throughput\b/.test(metricName)) return "higher"
  if (metricName === "test.pass_rate") return "higher"
  return "lower"
}

export function baselineTestEntryKey(testName: string): string {
  if (
    RESERVED_BASELINE_KEYS.has(testName) ||
    testName.startsWith(BASELINE_TEST_KEY_ESCAPE_PREFIX)
  ) {
    return `${BASELINE_TEST_KEY_ESCAPE_PREFIX}${testName}`
  }

  return testName
}

function buildSuiteBaselineData(
  aggregates: Record<string, number>,
  perTest: Record<string, Record<string, number>>,
): BaselineSuiteData {
  const suiteData: BaselineSuiteData = {
    _aggregate: buildMetricRecord(aggregates),
  }

  for (const [testName, metrics] of Object.entries(perTest)) {
    suiteData[baselineTestEntryKey(testName)] = buildMetricRecord(metrics)
  }

  return suiteData
}

function assignLegacySuiteData(
  target: BaselineFile,
  suiteData: BaselineSuiteData,
): void {
  for (const key of Object.keys(target)) {
    if (RESERVED_BASELINE_KEYS.has(key)) continue
    delete target[key]
  }

  target._aggregate = suiteData._aggregate
  for (const [key, value] of Object.entries(suiteData)) {
    if (key === "_aggregate") continue
    target[key] = value
  }
}

export function createBaselineFile(
  evalFilePath: string,
  aggregates: Record<string, number>,
  perTest: Record<string, Record<string, number>>,
): BaselineFile {
  const suiteData = buildSuiteBaselineData(aggregates, perTest)
  const file: BaselineFile = {
    _meta: {
      updatedAt: new Date().toISOString(),
      evalFile: basename(evalFilePath),
    },
    _aggregate: suiteData._aggregate,
  }

  assignLegacySuiteData(file, suiteData)

  return file
}

function buildMetricRecord(
  metrics: Record<string, number>,
): Record<string, BaselineMetric | number> {
  const record: Record<string, BaselineMetric | number> = {}

  for (const [name, value] of Object.entries(metrics)) {
    // Skip NaN values (would become null in JSON)
    if (Number.isNaN(value)) continue
    // Store as plain number — tolerance/direction are derived from defaults
    record[name] = value
  }

  return record
}

function createBaseMeta(evalFilePath: string): BaselineFile["_meta"] {
  return {
    updatedAt: new Date().toISOString(),
    evalFile: basename(evalFilePath),
  }
}

function normalizeSuitesValue(value: unknown): BaselineSuites {
  if (!value || typeof value !== "object") {
    return {}
  }

  const suites: BaselineSuites = {}
  for (const [suiteKey, suiteValue] of Object.entries(value)) {
    if (!suiteValue || typeof suiteValue !== "object") {
      continue
    }
    if (!("_aggregate" in suiteValue)) {
      continue
    }
    suites[suiteKey] = suiteValue as BaselineSuiteData
  }

  return suites
}

function suiteIdFromSuiteKey(suiteKey: string): string {
  const delimiterIndex = suiteKey.indexOf("::")
  if (delimiterIndex === -1) {
    return suiteKey
  }

  const identity = suiteKey.slice(0, delimiterIndex)
  const looksLikeIdentity =
    identity === "<unknown>" ||
    identity.includes("/") ||
    identity.includes("\\") ||
    identity.endsWith(".eval.ts") ||
    identity.endsWith(".eval.js")
  if (!looksLikeIdentity) {
    return suiteKey
  }

  const suiteId = suiteKey.slice(delimiterIndex + 2)
  return suiteId.length > 0 ? suiteId : suiteKey
}

function normalizeSuitesByStableId(suites: BaselineSuites): BaselineSuites {
  const normalized: BaselineSuites = {}

  // Prefer already-stable keys when both stable and legacy path keys exist.
  for (const [storedKey, suiteData] of Object.entries(suites)) {
    const stableId = suiteIdFromSuiteKey(storedKey)
    if (storedKey === stableId) {
      normalized[stableId] = suiteData
    }
  }

  // Fill remaining entries from legacy path-dependent keys.
  for (const [storedKey, suiteData] of Object.entries(suites)) {
    const stableId = suiteIdFromSuiteKey(storedKey)
    if (!(stableId in normalized)) {
      normalized[stableId] = suiteData
    }
  }

  return normalized
}

export function upsertSuiteBaseline(
  evalFilePath: string,
  existing: BaselineFile | null,
  suiteKey: string,
  aggregates: Record<string, number>,
  perTest: Record<string, Record<string, number>>,
): BaselineFile {
  const suiteData = buildSuiteBaselineData(aggregates, perTest)
  const stableSuiteId = suiteIdFromSuiteKey(suiteKey)
  const next: BaselineFile = existing
    ? { ...existing, _meta: createBaseMeta(evalFilePath) }
    : {
        _meta: createBaseMeta(evalFilePath),
        _aggregate: suiteData._aggregate,
      }

  const suites = normalizeSuitesByStableId(
    normalizeSuitesValue(existing?._suites),
  )
  suites[stableSuiteId] = suiteData
  next._suites = suites
  assignLegacySuiteData(next, suiteData)

  return next
}

export function resolveSuiteBaseline(
  baseline: BaselineFile,
  suiteKey: string,
): BaselineSuiteData | null {
  const stableSuiteId = suiteIdFromSuiteKey(suiteKey)
  const rawSuites = normalizeSuitesValue(baseline._suites)
  const suiteData =
    normalizeSuitesByStableId(rawSuites)[stableSuiteId] ?? rawSuites[suiteKey]
  if (suiteData) {
    return suiteData
  }

  if (!baseline._aggregate) {
    return null
  }

  const legacySuite: BaselineSuiteData = {
    _aggregate: baseline._aggregate,
  }

  for (const [key, value] of Object.entries(baseline)) {
    if (RESERVED_BASELINE_KEYS.has(key)) {
      continue
    }
    if (!value || typeof value !== "object") {
      continue
    }
    legacySuite[key] = value as Record<string, BaselineMetric | number>
  }

  return legacySuite
}

interface NormalizedMetricBaseline {
  value: number
  tolerance: number
  direction: "higher" | "lower"
}

function normalizeMetricBaseline(
  metricName: string,
  baselineEntry: BaselineMetric | number,
): NormalizedMetricBaseline {
  if (typeof baselineEntry === "number") {
    return {
      value: baselineEntry,
      tolerance: getDefaultTolerance(metricName),
      direction: getMetricDirection(metricName),
    }
  }

  return {
    value: baselineEntry.value,
    tolerance: baselineEntry.tolerance,
    direction: baselineEntry.direction ?? getMetricDirection(metricName),
  }
}

function hasRegression(
  currentValue: number,
  baselineValue: number,
  tolerance: number,
  direction: "higher" | "lower",
): boolean {
  if (direction === "lower") {
    return currentValue > baselineValue * (1 + tolerance)
  }

  return currentValue < baselineValue * (1 - tolerance)
}

export function compareMetrics(
  current: Record<string, number>,
  baseline: Record<string, BaselineMetric | number>,
): ComparisonResult[] {
  const results: ComparisonResult[] = []

  for (const [metric, baselineEntry] of Object.entries(baseline)) {
    if (!(metric in current)) continue
    if (baselineEntry == null) continue

    const currentValue = current[metric]
    if (currentValue === undefined) continue

    const normalized = normalizeMetricBaseline(metric, baselineEntry)
    const change =
      normalized.value === 0
        ? 0
        : (currentValue - normalized.value) / normalized.value
    const regressed = hasRegression(
      currentValue,
      normalized.value,
      normalized.tolerance,
      normalized.direction,
    )

    results.push({
      metric,
      current: currentValue,
      baseline: normalized.value,
      tolerance: normalized.tolerance,
      change,
      regressed,
      direction: normalized.direction,
    })
  }

  return results
}
