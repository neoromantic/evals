import { describe, expect, test } from "bun:test"
import {
  classifyScorerScore,
  displayMetricName,
  formatMetricValue,
  printSuiteReport,
  printVariantComparisonTables,
  shouldPrintVerboseTest,
} from "./reporter"
import type { SuiteReport, VerboseTestReport } from "./types"

describe("reporter ttfb handling", () => {
  test("uses consistent naming and formatting for ttfb metrics", () => {
    expect(displayMetricName("ttfb")).toBe("TTFB")
    expect(displayMetricName("ttfb.avg")).toBe("TTFB (avg)")
    expect(formatMetricValue("ttfb", 250)).toBe("250 ms")
    expect(formatMetricValue("ttfb.avg", 1250)).toBe("1.3s")
  })
})

describe("reporter verbose helpers", () => {
  test("classifies score states against pass threshold", () => {
    expect(classifyScorerScore(0.49, 0.5)).toBe("fail")
    expect(classifyScorerScore(0.5, 0.5)).toBe("low")
    expect(classifyScorerScore(0.9, 0.5)).toBe("low")
    expect(classifyScorerScore(1, 0.5)).toBe("pass")
  })

  test("respects custom thresholds at boundary values", () => {
    expect(classifyScorerScore(0.749, 0.75)).toBe("fail")
    expect(classifyScorerScore(0.75, 0.75)).toBe("low")
    expect(classifyScorerScore(1.05, 0.75)).toBe("pass")
  })

  test("prints verbose details only for non-perfect scorer results", () => {
    expect(
      shouldPrintVerboseTest({
        testName: "A",
        displayName: "A",
        passed: true,
        metrics: {},
        scorerResults: [{ name: "ExactMatch", score: 1 }],
      }),
    ).toBe(false)

    expect(
      shouldPrintVerboseTest({
        testName: "B",
        displayName: "B",
        passed: true,
        metrics: {},
        scorerResults: [{ name: "Factuality", score: 0.6 }],
      }),
    ).toBe(true)
  })

  test("ignores pass flag and empty scorer list when selecting tests", () => {
    expect(
      shouldPrintVerboseTest({
        testName: "empty",
        displayName: "empty",
        passed: false,
        metrics: {},
        scorerResults: [],
      }),
    ).toBe(false)

    expect(
      shouldPrintVerboseTest({
        testName: "perfect-fail",
        displayName: "perfect-fail",
        passed: false,
        metrics: {},
        scorerResults: [{ name: "ExactMatch", score: 1 }],
      }),
    ).toBe(false)
  })
})

describe("reporter verbose scorer diagnostics", () => {
  test("prints verbose block only for tests with non-perfect scores", () => {
    const report = createReport([
      createVerboseTest("perfect", [1]),
      createVerboseTest("low-only", [0.95]),
      createVerboseTest("failing", [0.3, 1]),
    ])

    const output = stripAnsi(
      captureLogs(() => printSuiteReport(report, undefined, { verbose: true })),
    )

    expect(output).toContain("SCORER DETAILS (2 of 3)")
    expect(output).toContain("low-only")
    expect(output).toContain("failing")
    expect(output).not.toContain("perfect")
    expect(output).toContain("no hard failures")
    expect(output).toContain("1 below threshold")
    expect(output).toContain("LOW")
    expect(output).toContain("FAIL")
    expect(output).toContain("PASS")
  })

  test("prints perfect-score message when every scorer is 1.00", () => {
    const report = createReport([
      createVerboseTest("all-good-a", [1]),
      createVerboseTest("all-good-b", [1, 1]),
    ])

    const output = stripAnsi(
      captureLogs(() => printSuiteReport(report, undefined, { verbose: true })),
    )

    expect(output).toContain("SCORER DETAILS")
    expect(output).toContain("All scorer checks are perfect (1.00).")
  })
})

describe("reporter variant comparison tables", () => {
  test("prints comparison table for variant suites", () => {
    const reports: SuiteReport[] = [
      {
        ...createReport([]),
        suiteName: "People Search [exa]",
        testCount: 3,
        passRate: 0.67,
        aggregates: {
          "score.PeopleSearchRelevancy.avg": 0.76,
          "latency.avg": 620,
          "test.pass_rate": 0.67,
        },
      },
      {
        ...createReport([]),
        suiteName: "People Search [firecrawl]",
        testCount: 3,
        passRate: 1,
        aggregates: {
          "score.PeopleSearchRelevancy.avg": 0.82,
          "latency.avg": 980,
          "test.pass_rate": 1,
        },
      },
      {
        ...createReport([]),
        suiteName: "People Search [sonar]",
        testCount: 3,
        passRate: 1,
        aggregates: {
          "score.PeopleSearchRelevancy.avg": 0.79,
          "latency.avg": 1300,
          "test.pass_rate": 1,
        },
      },
    ]

    const output = stripAnsi(
      captureLogs(() => printVariantComparisonTables(reports)),
    )

    expect(output).toContain("VARIANT COMPARISON: People Search")
    expect(output).toContain("| Metric")
    expect(output).toContain("exa")
    expect(output).toContain("firecrawl")
    expect(output).toContain("sonar")
    expect(output).toContain("PeopleSearchRelevancy (avg)")
    expect(output).toContain("Latency (avg)")
    expect(output).toContain("Pass Rate")
  })
})

function createVerboseTest(name: string, scores: number[]): VerboseTestReport {
  return {
    testName: name,
    displayName: name,
    passed: true,
    metrics: {},
    scorerResults: scores.map((score, idx) => ({
      name: `Scorer${idx + 1}`,
      score,
    })),
  }
}

function createReport(tests: VerboseTestReport[]): SuiteReport {
  return {
    suiteName: "verbose suite",
    testCount: tests.length,
    passRate: 1,
    passThreshold: 0.8,
    aggregates: {
      "score.main.avg": 1,
    },
    comparisons: [],
    perTestComparisons: {},
    tests,
  }
}

function captureLogs(fn: () => void): string {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => lines.push(args.join(" "))
  try {
    fn()
  } finally {
    console.log = originalLog
  }
  return lines.join("\n")
}

function stripAnsi(value: string): string {
  let output = ""
  let insideAnsiSequence = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const nextChar = value[index + 1]

    if (!insideAnsiSequence && char === "\u001b" && nextChar === "[") {
      insideAnsiSequence = true
      continue
    }

    if (insideAnsiSequence) {
      if (char === "m") {
        insideAnsiSequence = false
      }
      continue
    }

    output += char
  }

  return output
}
