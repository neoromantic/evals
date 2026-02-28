import { describe, expect, test } from "bun:test"
import { JsonMatch, NumericCloseness } from "./scorer"

describe("JsonMatch", () => {
  test("treats objects with different key insertion order as equal", async () => {
    const raw = JsonMatch.scorer({
      input: "",
      output: {
        alpha: 1,
        nested: { left: 1, right: 2 },
      },
      expected: {
        nested: { right: 2, left: 1 },
        alpha: 1,
      },
    })

    const value = await scoreValue(raw)
    expect(value).toBe(1)
  })
})

describe("NumericCloseness", () => {
  test("never returns less than 0", async () => {
    const raw = NumericCloseness.scorer({
      input: "",
      output: 10,
      expected: -10,
    })

    const value = await scoreValue(raw)
    expect(value).toBe(0)
  })

  test("returns 1 for identical values", async () => {
    const raw = NumericCloseness.scorer({
      input: "",
      output: 42,
      expected: 42,
    })

    const value = await scoreValue(raw)
    expect(value).toBe(1)
  })

  test("handles non-finite values without NaN", async () => {
    const infEqual = NumericCloseness.scorer({
      input: "",
      output: Number.POSITIVE_INFINITY,
      expected: Number.POSITIVE_INFINITY,
    })
    const mixedInfinite = NumericCloseness.scorer({
      input: "",
      output: Number.POSITIVE_INFINITY,
      expected: Number.NEGATIVE_INFINITY,
    })
    const nanValue = NumericCloseness.scorer({
      input: "",
      output: Number.NaN,
      expected: 1,
    })

    expect(await scoreValue(infEqual)).toBe(1)
    expect(await scoreValue(mixedInfinite)).toBe(0)
    expect(await scoreValue(nanValue)).toBe(0)
  })
})

async function scoreValue(
  raw:
    | number
    | { score: number; metadata?: unknown }
    | Promise<number | { score: number; metadata?: unknown }>,
): Promise<number> {
  const result = await raw
  return typeof result === "number" ? result : result.score
}
