import { describe, expect, test } from "bun:test"
import {
  compareMetrics,
  createBaselineFile,
  getBaselinePath,
  getDefaultTolerance,
  resolveSuiteBaseline,
  upsertSuiteBaseline,
} from "./baseline"

describe("getBaselinePath", () => {
  test("builds baseline path from .eval.ts", () => {
    expect(getBaselinePath("/tmp/suite/example.eval.ts")).toBe(
      "/tmp/suite/example.eval.baseline.json",
    )
  })

  test("builds baseline path from .eval.js", () => {
    expect(getBaselinePath("/tmp/suite/example.eval.js")).toBe(
      "/tmp/suite/example.eval.baseline.json",
    )
  })
})

describe("suite baseline persistence", () => {
  test("preserves multiple suites in a single eval baseline", () => {
    const evalPath = "/tmp/suite/example.eval.ts"

    let baseline = upsertSuiteBaseline(
      evalPath,
      null,
      `${evalPath}::suite A`,
      { "score.main.avg": 0.8, "ttfb.avg": 100 },
      { caseA: { "score.main": 0.8 } },
    )

    baseline = upsertSuiteBaseline(
      evalPath,
      baseline,
      `${evalPath}::suite B`,
      { "score.main.avg": 0.2, "ttfb.avg": 200 },
      { caseB: { "score.main": 0.2 } },
    )

    expect(Object.keys(baseline._suites ?? {}).sort()).toEqual([
      "suite A",
      "suite B",
    ])

    const suiteA = resolveSuiteBaseline(baseline, `${evalPath}::suite A`)
    const suiteB = resolveSuiteBaseline(baseline, `${evalPath}::suite B`)

    expect(suiteA?._aggregate["score.main.avg"]).toBe(0.8)
    expect(suiteB?._aggregate["score.main.avg"]).toBe(0.2)

    const againstSuiteA = compareMetrics(
      { "score.main.avg": 0.4 },
      suiteA?._aggregate ?? {},
    )
    const againstSuiteB = compareMetrics(
      { "score.main.avg": 0.4 },
      suiteB?._aggregate ?? {},
    )

    expect(
      againstSuiteA.find((entry) => entry.metric === "score.main.avg")
        ?.regressed,
    ).toBe(true)
    expect(
      againstSuiteB.find((entry) => entry.metric === "score.main.avg")
        ?.regressed,
    ).toBe(false)
  })

  test("resolves legacy absolute suite keys with new checkout path suite keys", () => {
    const legacyPath = "/old/checkout/packages/evals/suite.eval.ts"
    const newPath = "/new/checkout/packages/evals/suite.eval.ts"
    const baseline = {
      _meta: {
        updatedAt: "2026-01-01T00:00:00.000Z",
        evalFile: "suite.eval.ts",
      },
      _aggregate: { "score.main.avg": 0.9 },
      _suites: {
        [`${legacyPath}::shared suite`]: {
          _aggregate: { "score.main.avg": 0.9 },
          case1: { "score.main": 0.9 },
        },
      },
    }

    const resolved = resolveSuiteBaseline(baseline, `${newPath}::shared suite`)
    expect(resolved?._aggregate["score.main.avg"]).toBe(0.9)
    expect(resolved?.case1?.["score.main"]).toBe(0.9)
  })

  test("upsert normalizes legacy _suites keys to stable IDs and removes stale path keys", () => {
    const oldPath = "/old/checkout/packages/evals/suite.eval.ts"
    const newPath = "/new/checkout/packages/evals/suite.eval.ts"
    const existing = {
      _meta: {
        updatedAt: "2026-01-01T00:00:00.000Z",
        evalFile: "suite.eval.ts",
      },
      _aggregate: { "score.main.avg": 0.1 },
      _suites: {
        [`${oldPath}::suite A`]: { _aggregate: { "score.main.avg": 0.1 } },
        [`${oldPath}::suite B`]: { _aggregate: { "score.main.avg": 0.2 } },
      },
    }

    const updated = upsertSuiteBaseline(
      newPath,
      existing,
      `${newPath}::suite A`,
      { "score.main.avg": 0.8 },
      {},
    )

    expect(Object.keys(updated._suites ?? {}).sort()).toEqual([
      "suite A",
      "suite B",
    ])
    expect(updated._suites?.["suite A"]?._aggregate["score.main.avg"]).toBe(0.8)
    expect(updated._suites?.["suite B"]?._aggregate["score.main.avg"]).toBe(0.2)
    expect(updated._suites?.[`${oldPath}::suite A`]).toBeUndefined()
    expect(updated._suites?.[`${oldPath}::suite B`]).toBeUndefined()
  })

  test("suite IDs preserve full suite names containing double colons", () => {
    const evalPath = "/tmp/suite/with-colons.eval.ts"
    const suiteAKey = `${evalPath}::group::alpha`
    const suiteBKey = `${evalPath}::group::beta`

    let baseline = upsertSuiteBaseline(
      evalPath,
      null,
      suiteAKey,
      { "score.main.avg": 0.7 },
      { case1: { "score.main": 0.7 } },
    )
    baseline = upsertSuiteBaseline(
      evalPath,
      baseline,
      suiteBKey,
      { "score.main.avg": 0.4 },
      { case1: { "score.main": 0.4 } },
    )

    expect(Object.keys(baseline._suites ?? {}).sort()).toEqual([
      "group::alpha",
      "group::beta",
    ])
    expect(
      resolveSuiteBaseline(baseline, suiteAKey)?._aggregate["score.main.avg"],
    ).toBe(0.7)
    expect(
      resolveSuiteBaseline(baseline, suiteBKey)?._aggregate["score.main.avg"],
    ).toBe(0.4)
  })

  test("legacy absolute keys with double-colon suite names resolve and upsert without collision", () => {
    const oldPath = "/old/checkout/packages/evals/suite.eval.ts"
    const newPath = "/new/checkout/packages/evals/suite.eval.ts"
    const existing = {
      _meta: {
        updatedAt: "2026-01-01T00:00:00.000Z",
        evalFile: "suite.eval.ts",
      },
      _aggregate: { "score.main.avg": 0.1 },
      _suites: {
        [`${oldPath}::group::alpha`]: {
          _aggregate: { "score.main.avg": 0.11 },
        },
        [`${oldPath}::group::beta`]: { _aggregate: { "score.main.avg": 0.22 } },
      },
    }

    const resolvedAlpha = resolveSuiteBaseline(
      existing,
      `${newPath}::group::alpha`,
    )
    const resolvedBeta = resolveSuiteBaseline(
      existing,
      `${newPath}::group::beta`,
    )
    expect(resolvedAlpha?._aggregate["score.main.avg"]).toBe(0.11)
    expect(resolvedBeta?._aggregate["score.main.avg"]).toBe(0.22)

    const updated = upsertSuiteBaseline(
      newPath,
      existing,
      `${newPath}::group::alpha`,
      { "score.main.avg": 0.99 },
      {},
    )

    expect(Object.keys(updated._suites ?? {}).sort()).toEqual([
      "group::alpha",
      "group::beta",
    ])
    expect(
      updated._suites?.["group::alpha"]?._aggregate["score.main.avg"],
    ).toBe(0.99)
    expect(updated._suites?.["group::beta"]?._aggregate["score.main.avg"]).toBe(
      0.22,
    )
  })

  test("guards reserved baseline keys for test entries", () => {
    const baseline = createBaselineFile(
      "/tmp/suite/example.eval.ts",
      { "test.count": 3 },
      {
        _meta: { latency: 11 },
        _aggregate: { latency: 22 },
        _suites: { latency: 33 },
        "@already-prefixed": { latency: 44 },
      },
    )

    expect(typeof baseline._meta.updatedAt).toBe("string")
    expect(baseline._aggregate["test.count"]).toBe(3)
    expect(baseline["@_meta"]).toEqual({ latency: 11 })
    expect(baseline["@_aggregate"]).toEqual({ latency: 22 })
    expect(baseline["@_suites"]).toEqual({ latency: 33 })
    expect(baseline["@@already-prefixed"]).toEqual({ latency: 44 })
  })
})

describe("ttfb defaults", () => {
  test("uses latency tolerance for ttfb aggregate metrics", () => {
    expect(getDefaultTolerance("ttfb")).toBe(0.2)
    expect(getDefaultTolerance("ttfb.avg")).toBe(0.2)

    const comparisons = compareMetrics({ "ttfb.avg": 115 }, { "ttfb.avg": 100 })
    expect(comparisons[0]?.regressed).toBe(false)
  })
})
