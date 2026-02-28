import { afterEach, describe, expect, test } from "bun:test"
import { collector } from "./collector"

afterEach(() => {
  collector.reset()
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("collector.recordTokens", () => {
  test("accumulates token usage across multiple calls", () => {
    collector.beginTest("suite", "test")

    collector.recordTokens({
      promptTokens: 2,
      completionTokens: 3,
    })
    collector.recordTokens({
      promptTokens: 4,
      completionTokens: 5,
      totalTokens: 20,
    })

    collector.endTest()

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.input"]).toBe(6)
    expect(entry?.metrics["tokens.output"]).toBe(8)
    expect(entry?.metrics["tokens.total"]).toBe(25)
  })
})

describe("collector suite identity", () => {
  test("keeps same suite name in different eval files isolated", () => {
    const suiteAKey = collector.registerSuite(
      "shared suite",
      { passThreshold: 0.1 },
      "/tmp/a.eval.ts",
    )
    const suiteBKey = collector.registerSuite(
      "shared suite",
      { passThreshold: 0.9 },
      "/tmp/b.eval.ts",
    )

    collector.beginTest(suiteAKey, "shared suite", "test a")
    collector.recordMetric("latency", 10)
    collector.endTest()

    collector.beginTest(suiteBKey, "shared suite", "test b")
    collector.recordMetric("latency", 20)
    collector.endTest()

    expect(suiteAKey).not.toBe(suiteBKey)
    expect(collector.getSuiteConfig(suiteAKey)?.passThreshold).toBe(0.1)
    expect(collector.getSuiteConfig(suiteBKey)?.passThreshold).toBe(0.9)
    expect(collector.getEvalFile(suiteAKey)).toBe("/tmp/a.eval.ts")
    expect(collector.getEvalFile(suiteBKey)).toBe("/tmp/b.eval.ts")
    expect(collector.getSuiteKeys()).toEqual([suiteAKey, suiteBKey])
    expect(
      collector.getTestResultsForSuite(suiteAKey).map((t) => t.testName),
    ).toEqual(["test a"])
    expect(
      collector.getTestResultsForSuite(suiteBKey).map((t) => t.testName),
    ).toEqual(["test b"])
  })
})

describe("collector async context isolation", () => {
  test("keeps overlapping runTest metrics scoped to each case", async () => {
    await Promise.all([
      collector.runTest("suite", "suite", "case-a", async () => {
        collector.recordMetric("value", 1)
        await sleep(50)
        collector.recordScore("exact", 1)
      }),
      collector.runTest("suite", "suite", "case-b", async () => {
        collector.recordMetric("value", 2)
        await sleep(20)
        collector.recordScore("exact", 0)
        collector.setTestPassed(false)
      }),
    ])

    const results = collector.getTestResults()
    const caseA = results.find((entry) => entry.testName === "case-a")
    const caseB = results.find((entry) => entry.testName === "case-b")

    expect(caseA?.metrics.value).toBe(1)
    expect(caseA?.metrics["score.exact"]).toBe(1)
    expect(caseA?.passed).toBe(true)
    expect(caseB?.metrics.value).toBe(2)
    expect(caseB?.metrics["score.exact"]).toBe(0)
    expect(caseB?.passed).toBe(false)
  })
})
