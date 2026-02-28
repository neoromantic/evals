import type { Scorer, ScorerInput } from "./types"

interface ScorerOpts<TInput = string, TOutput = string, TExpected = TOutput> {
  name: string
  description?: string
  scorer: (
    input: ScorerInput<TInput, TOutput, TExpected>,
  ) =>
    | number
    | { score: number; metadata?: unknown }
    | Promise<number | { score: number; metadata?: unknown }>
}

export function createScorer<
  TInput = string,
  TOutput = string,
  TExpected = TOutput,
>(
  opts: ScorerOpts<TInput, TOutput, TExpected>,
): Scorer<TInput, TOutput, TExpected> {
  return {
    name: opts.name,
    description: opts.description,
    scorer: opts.scorer,
  }
}

// ---------------------------------------------------------------------------
// Built-in heuristic scorers
// ---------------------------------------------------------------------------

export const ExactMatch = createScorer<string, string, string>({
  name: "ExactMatch",
  description: "Strict equality between output and expected",
  scorer: ({ output, expected }) => (output === expected ? 1 : 0),
})

export const Contains = createScorer<string, string, string>({
  name: "Contains",
  description: "Check if output contains expected as a substring",
  scorer: ({ output, expected }) =>
    String(output).includes(String(expected)) ? 1 : 0,
})

export const ContainsAll = createScorer<string, string, string[]>({
  name: "ContainsAll",
  description: "Check if output contains all expected terms (case-insensitive)",
  scorer: ({ output, expected }) => {
    const terms = expected ?? []
    if (terms.length === 0) return 1
    const lower = String(output).toLowerCase()
    const found = terms.filter((t) => lower.includes(String(t).toLowerCase()))
    return found.length / terms.length
  },
})

export const ContainsAny = createScorer<string, string, string[]>({
  name: "ContainsAny",
  description:
    "Check if output contains any of the expected terms (case-insensitive)",
  scorer: ({ output, expected }) => {
    const terms = expected ?? []
    if (terms.length === 0) return 0
    const lower = String(output).toLowerCase()
    return terms.some((t) => lower.includes(String(t).toLowerCase())) ? 1 : 0
  },
})

export const JsonMatch = createScorer<string, unknown, unknown>({
  name: "JsonMatch",
  description: "Deep object equality (ignores object key insertion order)",
  scorer: ({ output, expected }) =>
    JSON.stringify(stableJsonValue(output)) ===
    JSON.stringify(stableJsonValue(expected))
      ? 1
      : 0,
})

export const NumericCloseness = createScorer<string, number, number>({
  name: "NumericCloseness",
  description: "Score based on numeric proximity between output and expected",
  scorer: ({ output, expected }) => {
    const a = Number(output)
    const b = Number(expected)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return a === b ? 1 : 0
    }
    if (a === 0 && b === 0) return 1
    const denom = Math.max(Math.abs(a), Math.abs(b))
    const closeness = 1 - Math.abs(a - b) / denom
    if (!Number.isFinite(closeness)) return 0
    return Math.max(0, Math.min(1, closeness))
  },
})

export const LengthRatio = createScorer<string, string, string>({
  name: "LengthRatio",
  description: "Ratio of output length to expected length (capped at 1)",
  scorer: ({ output, expected }) => {
    const outLen = String(output).length
    const expLen = String(expected).length
    if (expLen === 0) return 0
    return Math.min(outLen / expLen, 1)
  },
})

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue)
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
    )
    const normalized: Record<string, unknown> = {}
    for (const [key, childValue] of entries) {
      normalized[key] = stableJsonValue(childValue)
    }
    return normalized
  }

  return value
}
