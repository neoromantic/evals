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

/** Transform internal metric names to human-friendly display names */
export function displayMetricName(name: string): string {
  if (name === "test.count") return "Tests"
  if (name === "test.pass_rate") return "Pass Rate"
  if (name === "latency") return "Latency"
  if (name === "ttfb") return "TTFB"

  // tokens.input.sum → Input Tokens, etc.
  if (name === "tokens.input.sum") return "Input Tokens"
  if (name === "tokens.output.sum") return "Output Tokens"
  if (name === "tokens.total.sum") return "Total Tokens"
  if (name === "tokens.input") return "Input Tokens"
  if (name === "tokens.output") return "Output Tokens"
  if (name === "tokens.total") return "Total Tokens"

  // score.X.avg → X (avg), score.X.min → X (min)
  const scoreAgg = name.match(/^score\.(.+)\.(avg|min|sum|count|rate)$/)
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

  // Score / pass_rate → show as decimal (0.85)
  if (lower.startsWith("score") || lower.endsWith("pass_rate")) {
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

function testsWithPerTestChanges(report: SuiteReport): string[] {
  return Object.keys(report.perTestComparisons).filter(
    (testName) => report.perTestComparisons[testName]!.length > 0,
  )
}

function appendBaselineComparison(
  line: string,
  metricName: string,
  currentComparison: ComparisonResult | undefined,
): string {
  if (!currentComparison) {
    return line
  }

  const baselineFormatted = formatMetricValue(
    metricName,
    currentComparison.baseline,
  )
  let nextLine = line
  nextLine += `${dim("was")} ${padRight(baselineFormatted, 10)}`
  nextLine += formatChange(currentComparison)
  return nextLine
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

function formatMetadata(metadata: unknown): string | null {
  if (metadata === undefined) {
    return null
  }

  if (typeof metadata === "string") {
    return metadata
  }

  const serialized = JSON.stringify(metadata, null, 2)
  if (!serialized) {
    return null
  }

  return serialized
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
      let line = `     ${padRight(scorerResult.name, scorerNameWidth + 2)}`
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

      const metadata = formatMetadata(scorerResult.metadata)
      if (metadata && scorerResult.score < 1) {
        console.log(`       ${dim("metadata:")}`)
        for (const line of metadataLines(scorerResult.metadata)) {
          console.log(`         ${dim(line)}`)
        }
      }
    }
  }
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

  // Aggregates (skip NaN values)
  const aggEntries = Object.entries(report.aggregates).filter(
    ([, v]) => !Number.isNaN(v),
  )
  const aggComparisons = report.comparisons

  if (aggEntries.length > 0) {
    console.log(bold(" AGGREGATES"))

    // Compute dynamic column width from display names
    const nameWidth = metricLabelWidth(
      aggEntries.map(([metricName]) => metricName),
    )

    for (const [name, value] of aggEntries) {
      const label = displayMetricName(name)
      const formatted = formatMetricValue(name, value)
      const comp = aggComparisons.find((c) => c.metric === name)

      let line = `   ${padRight(label, nameWidth)}${padRight(formatted, 10)}`
      line = appendBaselineComparison(line, name, comp)

      console.log(line)
    }
  }

  // Per-test changes
  const testsWithChanges = testsWithPerTestChanges(report)

  if (testsWithChanges.length > 0) {
    console.log("")
    console.log(
      bold(
        ` PER-TEST CHANGES (${testsWithChanges.length} of ${report.testCount})`,
      ),
    )

    // Compute dynamic width for per-test metric names
    const allComps = testsWithChanges.flatMap(
      (testName) => report.perTestComparisons[testName]!,
    )
    const testNameWidth = metricLabelWidth(allComps.map((comp) => comp.metric))

    for (const testName of testsWithChanges) {
      console.log(`   ${cyan(testName)}`)
      const comps = report.perTestComparisons[testName]!
      for (const comp of comps) {
        const label = displayMetricName(comp.metric)
        const formatted = formatMetricValue(comp.metric, comp.current)
        const baseFormatted = formatMetricValue(comp.metric, comp.baseline)

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
          formatMetricValue(metricName, metricValue).length,
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

    for (const testName of Object.keys(report.perTestComparisons)) {
      for (const comp of report.perTestComparisons[testName]!) {
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
    for (const metricName of [...metricSet]) {
      if (!(metricName in entry.report.aggregates)) {
        metricSet.delete(metricName)
      }
    }
  }

  const metrics = [...metricSet]
  metrics.sort((left, right) => {
    const leftPriority = metricPriority(left)
    const rightPriority = metricPriority(right)
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
    return displayMetricName(left).localeCompare(displayMetricName(right))
  })

  return metrics
}

function metricPriority(metricName: string): number {
  if (metricName.startsWith("score.") && metricName.endsWith(".avg")) return 1
  if (metricName === "latency.avg") return 2
  if (metricName === "test.pass_rate") return 3
  if (metricName === "error.rate") return 4
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
  if (s.length >= width) return s
  return s + " ".repeat(width - s.length)
}
