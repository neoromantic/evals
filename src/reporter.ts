import type { ComparisonResult, SuiteReport, VerboseTestReport } from "./types"

// --- ANSI color helpers ---

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`
const green = (s: string) => `\x1b[32m${s}\x1b[39m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`
const red = (s: string) => `\x1b[31m${s}\x1b[39m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`

// --- Formatting helpers ---

const LINE_W = 60
const heavy = "═".repeat(LINE_W)
const light = "─".repeat(LINE_W - 2)
const GROUPED_AGGREGATE_RE =
  /^(score\..+|latency(?:\.\w+)?|ttfb(?:\.\w+)?|tokens(?:\.\w+)+)\.(avg|min|max|p50|p95|sum)$/

const METRIC_DISPLAY_NAMES: Record<string, string> = {
  "test.count": "Tests",
  "test.pass_rate": "Pass Rate",
  latency: "Latency",
  ttfb: "TTFB",
  "latency.scoring": "Scoring Latency",
  "latency.total": "Total Latency",
  "tokens.input.sum": "Input Tokens",
  "tokens.output.sum": "Output Tokens",
  "tokens.total.sum": "Total Tokens",
  "tokens.input": "Input Tokens",
  "tokens.output": "Output Tokens",
  "tokens.total": "Total Tokens",
  "tokens.scorer.input.sum": "Scorer Input Tokens",
  "tokens.scorer.output.sum": "Scorer Output Tokens",
  "tokens.scorer.total.sum": "Scorer Total Tokens",
  "tokens.scorer.input": "Scorer Input Tokens",
  "tokens.scorer.output": "Scorer Output Tokens",
  "tokens.scorer.total": "Scorer Total Tokens",
}

/** Transform internal metric names to human-friendly display names */
export function displayMetricName(name: string): string {
  const direct = METRIC_DISPLAY_NAMES[name]
  if (direct) return direct

  // score.X.avg → X (avg), score.X.min → X (min)
  const scoreAgg = name.match(
    /^score\.(.+)\.(avg|min|max|p50|p95|sum|count|rate)$/,
  )
  if (scoreAgg) return `${scoreAgg[1]} (${scoreAgg[2]})`

  // score.X → X (per-test, no agg suffix)
  const scoreRaw = name.match(/^score\.(.+)$/)
  if (scoreRaw) return scoreRaw[1]!

  // latency.sum → Latency (sum)
  const agg = name.match(/^(.+)\.(avg|min|sum|count|rate)$/)
  if (agg) {
    const baseName = agg[1]!
    const base =
      baseName === "ttfb"
        ? "TTFB"
        : baseName.charAt(0).toUpperCase() + baseName.slice(1)
    return `${base} (${agg[2]})`
  }

  return name
}

export function displayScore(score: number | null): string {
  if (score === null) return dim("N/A")
  const pct = Math.round(score * 100)
  const label = `${pct}%`
  if (pct >= 80) return green(label)
  if (pct >= 50) return yellow(label)
  return red(label)
}

/** Format a metric value for display. Uses the original metric name for classification. */
export function formatMetricValue(name: string, value: number): string {
  const lower = name.toLowerCase()

  // Latency / TTFB → seconds or milliseconds
  if (lower.startsWith("latency") || lower.startsWith("ttfb")) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
    return `${Math.round(value)} ms`
  }

  // Pass rate → PASS/FAIL/percentage
  if (lower.endsWith("pass_rate")) {
    if (value === 1) return green("PASS")
    if (value === 0) return red("FAIL")
    return yellow(`${Math.round(value * 100)}%`)
  }

  // Score → decimal (combined line renderer handles boolean-aware formatting)
  if (lower.startsWith("score")) {
    return value.toFixed(2)
  }

  // Test count → integer
  if (lower === "test.count") return String(Math.round(value))

  // Tokens → integer
  if (lower.startsWith("tokens")) return String(Math.round(value))

  // Error count → integer
  if (lower.startsWith("error")) return String(Math.round(value))

  return value.toFixed(2)
}

export function formatChange(comparison: ComparisonResult): string {
  const changePct = comparison.change * 100
  const sign = changePct >= 0 ? "+" : ""
  const pctStr = `${sign}${changePct.toFixed(1)}%`

  if (comparison.regressed) {
    const arrow = comparison.direction === "lower" ? "\u25B2" : "\u25BC"
    return `${red(pctStr)}  ${red(`${arrow} REGRESSION`)}`
  }

  // Near-zero changes → dim
  if (Math.abs(changePct) < 0.5) return dim(pctStr)

  // Color based on whether the change is an improvement or degradation
  const isImprovement =
    (comparison.direction === "lower" && changePct < 0) ||
    (comparison.direction === "higher" && changePct > 0)

  return isImprovement ? green(pctStr) : yellow(pctStr)
}

function metricLabelWidth(names: string[]): number {
  return (
    Math.max(...names.map((name) => displayMetricName(name).length), 12) + 2
  )
}

interface PrintSuiteReportOptions {
  verbose?: boolean
}

interface VariantSuiteEntry {
  baseSuiteName: string
  variantName: string
  report: SuiteReport
}

export function classifyScorerScore(
  score: number,
  passThreshold: number,
): "fail" | "low" | "pass" {
  if (score < passThreshold) {
    return "fail"
  }

  if (score < 1) {
    return "low"
  }

  return "pass"
}

export function shouldPrintVerboseTest(test: VerboseTestReport): boolean {
  return test.scorerResults.some((scorerResult) => scorerResult.score < 1)
}

function formatScorerStatus(score: number, passThreshold: number): string {
  const scoreText = score.toFixed(2)
  const status = classifyScorerScore(score, passThreshold)

  if (status === "fail") {
    return `${red(scoreText)}  ${red("FAIL")}`
  }

  if (status === "low") {
    return `${yellow(scoreText)}  ${yellow("LOW")}`
  }

  return `${green(scoreText)}  ${green("PASS")}`
}

function formatScoreSummary(score: number, passThreshold: number): string {
  const pct = `${Math.round(score * 100)}%`
  const margin = score - passThreshold
  const marginLabel = `${margin >= 0 ? "+" : ""}${margin.toFixed(2)}`
  return `${pct}, ${marginLabel} vs threshold ${passThreshold.toFixed(2)}`
}

function valueLines(value: unknown): string[] {
  if (value === undefined) {
    return []
  }

  if (typeof value === "string") {
    return normalizeMultiline(value).split("\n")
  }

  const serialized = JSON.stringify(value, null, 2)
  if (!serialized) {
    return []
  }

  return serialized.split("\n")
}

function metadataLines(metadata: unknown): string[] {
  if (metadata === undefined || metadata === null) {
    return []
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return valueLines(metadata)
  }

  const objectMetadata = metadata as Record<string, unknown>
  const rationale = objectMetadata.rationale
  const compactEntries = Object.entries(objectMetadata).filter(
    ([key]) => key !== "rationale",
  )
  const compactMetadata =
    compactEntries.length > 0 ? Object.fromEntries(compactEntries) : null
  const lines: string[] = []

  if (compactMetadata) {
    lines.push(...valueLines(compactMetadata))
  }

  if (typeof rationale === "string") {
    if (lines.length > 0) {
      lines.push("")
    }
    lines.push("rationale:")
    lines.push(...normalizeMultiline(rationale).split("\n"))
  } else if (rationale !== undefined) {
    if (lines.length > 0) {
      lines.push("")
    }
    lines.push("rationale:")
    lines.push(...valueLines(rationale))
  }

  return lines
}

function normalizeMultiline(value: string): string {
  return value.replaceAll("\\n", "\n").replaceAll("\r\n", "\n")
}

function factualityChoiceSummary(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }

  const objectMetadata = metadata as Record<string, unknown>
  const choice =
    typeof objectMetadata.choice === "string" ? objectMetadata.choice : null
  const choiceMeaning =
    typeof objectMetadata.choiceMeaning === "string"
      ? objectMetadata.choiceMeaning
      : null

  if (!choice) {
    return null
  }

  if (choiceMeaning) {
    return `judge decision: ${choice} -> ${choiceMeaning}`
  }

  return `judge decision: ${choice}`
}

function printValueBlock(label: string, value: unknown): void {
  const lines = valueLines(value)
  if (lines.length === 0) {
    return
  }

  console.log(`     ${bold(`${label}:`)}`)
  for (const line of lines) {
    console.log(`       ${line}`)
  }
}

function printVerboseScorerDetails(report: SuiteReport): void {
  const verboseTests = report.tests.filter(shouldPrintVerboseTest)

  console.log("")
  if (verboseTests.length === 0) {
    console.log(bold(" SCORER DETAILS"))
    console.log(`   ${green("All scorer checks are perfect (1.00).")}`)
    return
  }

  console.log(
    bold(` SCORER DETAILS (${verboseTests.length} of ${report.testCount})`),
  )

  const scorerNameWidth = Math.max(
    ...verboseTests.flatMap((test) =>
      test.scorerResults.map((scorerResult) => scorerResult.name.length),
    ),
    12,
  )

  for (const test of verboseTests) {
    const failedScorers = test.scorerResults.filter(
      (scorerResult) => scorerResult.score < report.passThreshold,
    ).length
    const failingLabel =
      failedScorers > 0
        ? red(`${failedScorers} below threshold`)
        : yellow("no hard failures")

    console.log(`   ${cyan(test.displayName)} ${dim(`(${failingLabel})`)}`)
    printValueBlock("Input", test.input)
    printValueBlock("Expected", test.expected)
    printValueBlock("Output", test.output)

    for (const scorerResult of test.scorerResults) {
      const kindBadge = scorerResult.kind === "judge" ? dim(" [judge]") : ""
      let line = `     ${padRight(scorerResult.name + kindBadge, scorerNameWidth + 2)}`
      line += formatScorerStatus(scorerResult.score, report.passThreshold)
      line += ` ${dim(`(${formatScoreSummary(scorerResult.score, report.passThreshold)})`)}`
      console.log(line)

      if (scorerResult.description) {
        console.log(`       ${dim(`about: ${scorerResult.description}`)}`)
      }

      const choiceSummary = factualityChoiceSummary(scorerResult.metadata)
      if (choiceSummary) {
        console.log(`       ${dim(choiceSummary)}`)
      }

      const metadata = metadataLines(scorerResult.metadata)
      if (metadata.length > 0 && scorerResult.score < 1) {
        console.log(`       ${dim("metadata:")}`)
        for (const line of metadata) {
          console.log(`         ${dim(line)}`)
        }
      }
    }
  }
}

function printPerTestResults(report: SuiteReport): void {
  if (report.tests.length === 0) return

  const hasScorers = report.tests.some((t) => t.scorerResults.length > 0)
  if (!hasScorers) return

  console.log(bold(" RESULTS"))

  for (const test of report.tests) {
    if (test.scorerResults.length === 0) continue

    const avg =
      test.scorerResults.reduce((sum, r) => sum + r.score, 0) /
      test.scorerResults.length
    const status =
      avg >= report.passThreshold ? green("PASS") : red("FAIL")
    console.log(
      `   ${cyan(test.displayName)}  ${status}  ${avg.toFixed(2)}`,
    )

    const nameWidth =
      Math.max(
        ...test.scorerResults.map((r) => r.name.length),
        12,
      ) + 2

    for (const result of test.scorerResults) {
      const label =
        result.name.length > 56
          ? `${result.name.slice(0, 53)}...`
          : result.name
      const scoreStatus =
        result.score >= report.passThreshold
          ? green("PASS")
          : red("FAIL")
      console.log(`     ${padRight(label, Math.min(nameWidth, 58))}${scoreStatus}`)
    }
    console.log("")
  }
}

function detectBooleanScores(report: SuiteReport): Set<string> {
  const booleans = new Set<string>()
  const nonBooleans = new Set<string>()
  for (const test of report.tests) {
    for (const [name, value] of Object.entries(test.metrics)) {
      if (!name.startsWith("score.")) continue
      if (nonBooleans.has(name)) continue
      if (value === 0 || value === 1) {
        booleans.add(name)
      } else {
        nonBooleans.add(name)
        booleans.delete(name)
      }
    }
  }
  return booleans
}

function formatScoreValue(value: number, isBoolean: boolean): string {
  if (isBoolean) {
    if (value === 1) return green("PASS")
    if (value === 0) return red("FAIL")
    return yellow(`${Math.round(value * 100)}%`)
  }
  return value.toFixed(2)
}

interface MetricGroup {
  baseName: string
  displayLabel: string
  kind: "score" | "latency" | "tokens"
  primary: number
  primaryOp: string
  min: number
  max: number
  p50: number
  p95: number
  isBoolean: boolean
}

function groupMetricAggregates(
  aggregates: Record<string, number>,
  booleanScores: Set<string>,
): MetricGroup[] {
  const groups = new Map<string, Record<string, number>>()

  for (const [key, value] of Object.entries(aggregates)) {
    const match = key.match(GROUPED_AGGREGATE_RE)
    if (!match) continue
    const baseName = match[1]!
    const op = match[2]!
    const group = groups.get(baseName) ?? {}
    group[op] = value
    groups.set(baseName, group)
  }

  const result: MetricGroup[] = []
  for (const [baseName, ops] of groups) {
    let kind: "score" | "latency" | "tokens"
    let primaryOp: string

    if (baseName.startsWith("score.")) {
      kind = "score"
      primaryOp = "avg"
    } else if (
      baseName === "latency" ||
      baseName.startsWith("latency.") ||
      baseName === "ttfb" ||
      baseName.startsWith("ttfb.")
    ) {
      kind = "latency"
      primaryOp = "avg"
    } else {
      kind = "tokens"
      primaryOp = "sum"
    }

    const primary = ops[primaryOp]
    if (primary === undefined) continue

    const displayLabel =
      kind === "score"
        ? baseName.replace(/^score\./, "")
        : displayMetricName(baseName)

    result.push({
      baseName,
      displayLabel,
      kind,
      primary,
      primaryOp,
      min: ops.min ?? 0,
      max: ops.max ?? 0,
      p50: ops.p50 ?? 0,
      p95: ops.p95 ?? 0,
      isBoolean: kind === "score" && booleanScores.has(baseName),
    })
  }

  result.sort((a, b) => {
    const priority = (g: MetricGroup) =>
      g.kind === "score" ? 1 : g.kind === "latency" ? 2 : 3
    return priority(a) - priority(b)
  })

  return result
}

function isGroupedAggregateKey(key: string): boolean {
  return GROUPED_AGGREGATE_RE.test(key)
}

export function printSuiteReport(
  report: SuiteReport,
  evalFile?: string,
  options?: PrintSuiteReportOptions,
): void {
  // Header
  console.log("")
  console.log(heavy)
  if (evalFile) {
    console.log(bold(` EVAL: ${evalFile}`))
  }
  console.log(heavy)
  console.log("")

  // Suite title
  console.log(
    bold(
      ` ${report.suiteName} (${report.testCount} tests, pass rate: ${displayScore(report.passRate)})`,
    ),
  )
  console.log(` ${light}`)

  printPerTestResults(report)

  // Aggregates (skip NaN values)
  const aggEntries = Object.entries(report.aggregates).filter(
    ([, v]) => !Number.isNaN(v),
  )
  const aggComparisons = report.comparisons
  const booleanScores = detectBooleanScores(report)

  if (aggEntries.length > 0) {
    console.log(bold(" AGGREGATES"))

    const metricGroups = groupMetricAggregates(
      report.aggregates,
      booleanScores,
    )
    const nonGroupedEntries = aggEntries.filter(
      ([key]) => !isGroupedAggregateKey(key),
    )

    const rows: Record<string, string>[] = []

    for (const group of metricGroups) {
      const fmtValue = (v: number) => {
        if (group.kind === "score") return formatScoreValue(v, group.isBoolean)
        return formatMetricValue(group.baseName, v)
      }

      const isInfoMetric =
        group.baseName === "latency.scoring" ||
        group.baseName === "latency.total" ||
        group.baseName.startsWith("tokens.scorer")
      const wrap = isInfoMetric ? dim : (s: string) => s

      const row: Record<string, string> = {
        Metric: wrap(group.displayLabel),
        [group.kind === "tokens" ? "Sum" : "Avg"]: wrap(
          fmtValue(group.primary),
        ),
      }

      if (group.min !== group.max) {
        row.Min = wrap(fmtValue(group.min))
        row.Max = wrap(fmtValue(group.max))
        row.P50 = wrap(fmtValue(group.p50))
        row.P95 = wrap(fmtValue(group.p95))
      }

      const primaryKey = `${group.baseName}.${group.primaryOp}`
      const comp = aggComparisons.find((c) => c.metric === primaryKey)
      if (comp && comp.change !== 0) {
        const fmtBaseline =
          group.kind === "score"
            ? formatScoreValue(comp.baseline, group.isBoolean)
            : formatMetricValue(group.baseName, comp.baseline)
        row.Baseline = `${fmtBaseline}  ${formatChange(comp)}`
      }

      rows.push(row)
    }

    for (const [name, value] of nonGroupedEntries) {
      const row: Record<string, string> = {
        Metric: displayMetricName(name),
        Avg: formatMetricValue(name, value),
      }
      const comp = aggComparisons.find((c) => c.metric === name)
      if (comp && comp.change !== 0) {
        row.Baseline = `${formatMetricValue(name, comp.baseline)}  ${formatChange(comp)}`
      }
      rows.push(row)
    }

    if (rows.length > 0) {
      const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
      const columns = [
        "Metric",
        "Avg",
        "Sum",
        "Min",
        "Max",
        "P50",
        "P95",
        "Baseline",
      ].filter((col) => allKeys.includes(col))
      console.log(Bun.inspect.table(rows, columns, { colors: true }))
    }
  }

  // Per-test changes — filter zero-change, use PASS/FAIL for boolean scores
  const perTestFiltered: [string, ComparisonResult[]][] = []
  for (const testName of Object.keys(report.perTestComparisons)) {
    const allComps = report.perTestComparisons[testName]!
    const changedComps = allComps.filter((c) => c.change !== 0)
    if (changedComps.length > 0) {
      perTestFiltered.push([testName, changedComps])
    }
  }

  if (perTestFiltered.length > 0) {
    console.log("")
    console.log(
      bold(
        ` PER-TEST CHANGES (${perTestFiltered.length} of ${report.testCount})`,
      ),
    )

    const allFilteredComps = perTestFiltered.flatMap(([, comps]) => comps)
    const testNameWidth = metricLabelWidth(
      allFilteredComps.map((comp) => comp.metric),
    )

    for (const [testName, comps] of perTestFiltered) {
      console.log(`   ${cyan(testName)}`)
      for (const comp of comps) {
        const label = displayMetricName(comp.metric)
        const isBoolean =
          comp.metric.startsWith("score.") && booleanScores.has(comp.metric)

        const formatted = isBoolean
          ? formatScoreValue(comp.current, true)
          : formatMetricValue(comp.metric, comp.current)
        const baseFormatted = isBoolean
          ? formatScoreValue(comp.baseline, true)
          : formatMetricValue(comp.metric, comp.baseline)

        let line = `     ${padRight(label, testNameWidth)}${padRight(formatted, 10)}`
        line += `${dim("was")} ${padRight(baseFormatted, 10)}`
        line += formatChange(comp)

        console.log(line)
      }
    }
  }

  if (options?.verbose) {
    printVerboseScorerDetails(report)
  }

  console.log("")
}

export function printVariantComparisonTables(reports: SuiteReport[]): void {
  const variantEntries = reports
    .map(asVariantSuiteEntry)
    .filter((entry): entry is VariantSuiteEntry => entry !== null)

  if (variantEntries.length === 0) {
    return
  }

  const groups = new Map<string, VariantSuiteEntry[]>()
  for (const entry of variantEntries) {
    const existing = groups.get(entry.baseSuiteName) ?? []
    existing.push(entry)
    groups.set(entry.baseSuiteName, existing)
  }

  for (const [baseSuiteName, entries] of groups) {
    if (entries.length < 2) {
      continue
    }

    entries.sort((left, right) =>
      left.variantName.localeCompare(right.variantName),
    )

    const metricNames = commonAggregateMetrics(entries)
    if (metricNames.length === 0) {
      continue
    }

    const metricColumnWidth = Math.max(
      "Metric".length,
      ...metricNames.map((metricName) => displayMetricName(metricName).length),
    )
    const variantColumnWidths = entries.map((entry) => {
      let width = entry.variantName.length
      for (const metricName of metricNames) {
        const metricValue = entry.report.aggregates[metricName]
        if (metricValue === undefined) {
          width = Math.max(width, "N/A".length)
          continue
        }
        width = Math.max(
          width,
          Bun.stripANSI(formatMetricValue(metricName, metricValue)).length,
        )
      }
      return width
    })
    const separator = buildTableSeparator(
      metricColumnWidth,
      variantColumnWidths,
    )

    console.log("")
    console.log(bold(` VARIANT COMPARISON: ${baseSuiteName}`))
    console.log(`   ${separator}`)
    console.log(
      `   ${formatTableRow(
        ["Metric", ...entries.map((entry) => entry.variantName)],
        [metricColumnWidth, ...variantColumnWidths],
      )}`,
    )
    console.log(`   ${separator}`)

    for (const metricName of metricNames) {
      const values = entries.map((entry) => {
        const metricValue = entry.report.aggregates[metricName]
        if (metricValue === undefined) {
          return "N/A"
        }
        return formatMetricValue(metricName, metricValue)
      })

      console.log(
        `   ${formatTableRow(
          [displayMetricName(metricName), ...values],
          [metricColumnWidth, ...variantColumnWidths],
        )}`,
      )
    }

    console.log(`   ${separator}`)
  }
}

export function printSummary(reports: SuiteReport[]): void {
  const summary = summarizeReports(reports)
  const parts: string[] = []

  if (!summary.hasBaseline) {
    parts.push(dim("no baseline"))
  } else if (summary.regressions > 0) {
    parts.push(red(`${summary.regressions} regressions`))
  } else {
    parts.push(green("0 regressions"))
  }

  if (summary.hasBaseline) parts.push(`${summary.metricsOk} metrics OK`)

  console.log(heavy)
  console.log(bold(` SUMMARY: ${parts.join(", ")}`))
  console.log(heavy)
}

interface SummaryCounts {
  regressions: number
  metricsOk: number
  hasBaseline: boolean
}

function summarizeReports(reports: SuiteReport[]): SummaryCounts {
  let regressions = 0
  let metricsOk = 0
  let hasBaseline = false

  for (const report of reports) {
    if (report.comparisons.length > 0) hasBaseline = true
    for (const comp of report.comparisons) {
      if (comp.regressed) regressions++
      else metricsOk++
    }

    for (const comps of Object.values(report.perTestComparisons)) {
      for (const comp of comps) {
        if (comp.regressed) regressions++
        else metricsOk++
      }
    }
  }

  return { regressions, metricsOk, hasBaseline }
}

// --- Internal utility ---

function asVariantSuiteEntry(report: SuiteReport): VariantSuiteEntry | null {
  const match = report.suiteName.match(/^(.*)\s\[(.+)\]$/)
  const baseSuiteName = match?.[1]?.trim()
  const variantName = match?.[2]?.trim()

  if (!baseSuiteName || !variantName) {
    return null
  }

  return {
    baseSuiteName,
    variantName,
    report,
  }
}

function commonAggregateMetrics(entries: VariantSuiteEntry[]): string[] {
  const [firstEntry, ...restEntries] = entries
  if (!firstEntry) {
    return []
  }

  const metricSet = new Set(Object.keys(firstEntry.report.aggregates))
  for (const entry of restEntries) {
    for (const metricName of metricSet) {
      if (!(metricName in entry.report.aggregates)) {
        metricSet.delete(metricName)
      }
    }
  }

  const metrics = [...metricSet]
  // Only show .avg for scores in variant comparison (min/max/p50/p95 shown inline)
  const filtered = metrics.filter((name) => {
    if (name.startsWith("score.")) return name.endsWith(".avg")
    if (name.startsWith("latency") || name.startsWith("ttfb"))
      return name.endsWith(".avg")
    if (name.startsWith("tokens.")) return name.endsWith(".sum")
    return true
  })
  filtered.sort((left, right) => {
    const leftPriority = metricPriority(left)
    const rightPriority = metricPriority(right)
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
    return displayMetricName(left).localeCompare(displayMetricName(right))
  })

  return filtered
}

function metricPriority(metricName: string): number {
  if (metricName.startsWith("score.") && metricName.endsWith(".avg")) return 1
  if (metricName === "latency.avg") return 2
  if (metricName === "latency.scoring.avg") return 2.1
  if (metricName === "latency.total.avg") return 2.2
  if (metricName === "test.pass_rate") return 3
  if (metricName === "error.rate") return 4
  if (metricName.startsWith("tokens.scorer.") && metricName.endsWith(".sum"))
    return 5.1
  if (metricName.startsWith("tokens.") && metricName.endsWith(".sum")) return 5
  return 10
}

function buildTableSeparator(
  metricWidth: number,
  variantWidths: number[],
): string {
  const segments = [metricWidth, ...variantWidths].map((width) =>
    "-".repeat(width + 2),
  )
  return `+${segments.join("+")}+`
}

function formatTableRow(cells: string[], widths: number[]): string {
  const padded = cells.map((cell, index) => padRight(cell, widths[index] ?? 0))
  return `| ${padded.join(" | ")} |`
}

function padRight(s: string, width: number): string {
  const visibleLength = Bun.stripANSI(s).length
  if (visibleLength >= width) return s
  return s + " ".repeat(width - visibleLength)
}
