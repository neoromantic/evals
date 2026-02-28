import { describe, expect, test } from "bun:test"
import { aggregateMetrics } from "./aggregate"
import type { TestMetrics } from "./types"

function makeTestMetrics(
  metrics: Record<string, number | boolean>,
  passed: boolean,
): TestMetrics {
  return {
    suiteKey: "suite::key",
    suiteName: "suite",
    testName: "test",
    metrics,
    weight: 1,
    passed,
    scorerResults: [],
  }
}

describe("aggregateMetrics error metrics", () => {
  test("computes error.count and error.rate over all tests", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ error: 1, "score.main": 0 }, false),
      makeTestMetrics({ "score.main": 1 }, true),
      makeTestMetrics({ "score.main": 1 }, true),
    ]

    const aggregates = aggregateMetrics(tests)

    expect(aggregates["error.count"]).toBe(1)
    expect(aggregates["error.rate"]).toBeCloseTo(1 / 3)
  })
})

describe("aggregateMetrics pass rate", () => {
  test("errored tests never count as pass even with passing score metrics", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ error: 1, "score.main": 1 }, false),
      makeTestMetrics({ "score.main": 1 }, true),
    ]

    const aggregates = aggregateMetrics(tests)

    expect(aggregates["test.pass_rate"]).toBe(0.5)
  })
})

describe("aggregateMetrics ttfb", () => {
  test("treats ttfb as a latency metric family", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ ttfb: 100, "score.main": 1 }, true),
      makeTestMetrics({ ttfb: 200, "score.main": 1 }, true),
    ]

    const aggregates = aggregateMetrics(tests)

    expect(aggregates["ttfb.sum"]).toBe(300)
    expect(aggregates["ttfb.avg"]).toBe(150)
  })
})
