import { describe, expect, test } from "bun:test"
import { buildEvalEstimate, summarizeEvalEstimates } from "./estimates"
import type { BaselineFile } from "./types"

describe("buildEvalEstimate", () => {
  test("builds a single-suite estimate from legacy aggregate data", () => {
    const baseline: BaselineFile = {
      _meta: {
        updatedAt: "2026-03-12T00:00:00.000Z",
        evalFile: "legacy.eval.ts",
      },
      _aggregate: {
        "latency.sum": 2400,
        "latency.max": 900,
        "tokens.total.sum": 180,
        "test.count": 3,
      },
    }

    expect(buildEvalEstimate("/tmp/legacy.eval.ts", baseline)).toMatchObject({
      hasBaseline: true,
      hasDetailedSuites: false,
      workMs: 2400,
      wallLowerBoundMs: 900,
      wallUpperBoundMs: 900,
      testCount: 3,
      tokens: {
        total: 180,
      },
      suites: [
        {
          label: "legacy.eval.ts",
          workMs: 2400,
          wallMs: 900,
          testCount: 3,
          tokens: {
            total: 180,
          },
        },
      ],
    })
  })

  test("sums suite estimates and combines task and scorer tokens", () => {
    const baseline: BaselineFile = {
      _meta: {
        updatedAt: "2026-03-12T00:00:00.000Z",
        evalFile: "multi.eval.ts",
      },
      _aggregate: {},
      _suites: {
        "Suite A": {
          _aggregate: {
            "latency.total.sum": { value: 4200, tolerance: 0.2 },
            "latency.total.max": 1300,
            "tokens.total.sum": 120,
            "tokens.scorer.total.sum": 40,
            "test.count": 4,
          },
        },
        "Suite B": {
          _aggregate: {
            "latency.sum": 1500,
            "latency.max": 700,
            "tokens.input.sum": 20,
            "tokens.output.sum": 15,
            "test.count": 2,
          },
        },
      },
    }

    expect(buildEvalEstimate("/tmp/multi.eval.ts", baseline)).toMatchObject({
      hasBaseline: true,
      hasDetailedSuites: true,
      workMs: 5700,
      wallLowerBoundMs: 1300,
      wallUpperBoundMs: 2000,
      testCount: 6,
      tokens: {
        input: 20,
        output: 15,
        total: 195,
      },
    })
  })

  test("returns an empty estimate when no baseline exists", () => {
    expect(buildEvalEstimate("/tmp/missing.eval.ts", null)).toMatchObject({
      hasBaseline: false,
      suites: [],
      workMs: null,
      wallLowerBoundMs: null,
      wallUpperBoundMs: null,
      tokens: {
        total: null,
      },
    })
  })
})

describe("summarizeEvalEstimates", () => {
  test("sums only known baseline estimates and tracks missing entries", () => {
    const summary = summarizeEvalEstimates([
      {
        evalFile: "/tmp/a.eval.ts",
        baselinePath: "/tmp/a.eval.baseline.json",
        baselineUpdatedAt: "2026-03-12T00:00:00.000Z",
        hasBaseline: true,
        hasDetailedSuites: false,
        suites: [],
        workMs: 1000,
        wallLowerBoundMs: 400,
        wallUpperBoundMs: 600,
        testCount: 2,
        tokens: {
          input: 10,
          output: 5,
          total: 15,
        },
      },
      {
        evalFile: "/tmp/b.eval.ts",
        baselinePath: "/tmp/b.eval.baseline.json",
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
      },
      {
        evalFile: "/tmp/c.eval.ts",
        baselinePath: "/tmp/c.eval.baseline.json",
        baselineUpdatedAt: "2026-03-12T00:00:00.000Z",
        hasBaseline: true,
        hasDetailedSuites: true,
        suites: [],
        workMs: 2500,
        wallLowerBoundMs: 900,
        wallUpperBoundMs: 1200,
        testCount: 3,
        tokens: {
          input: 20,
          output: 10,
          total: 30,
        },
      },
    ])

    expect(summary).toEqual({
      selectedCount: 3,
      estimatedCount: 2,
      missingCount: 1,
      workMs: 3500,
      wallLowerBoundMs: 1300,
      wallUpperBoundMs: 1800,
      tokens: {
        input: 30,
        output: 15,
        total: 45,
      },
    })
  })
})
