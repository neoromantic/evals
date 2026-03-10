import type { Scorer, ScorerInput } from "./types"

// ---------------------------------------------------------------------------
// createLLMJudgeScorer — model-agnostic LLM judge wrapper
// ---------------------------------------------------------------------------

interface LLMJudgeScorerOpts<
  TInput = string,
  TOutput = string,
  TExpected = TOutput,
> {
  name: string
  description?: string
  judge: (
    input: ScorerInput<TInput, TOutput, TExpected>,
  ) => Promise<number | { score: number; metadata?: unknown }>
  retries?: number
  retryDelayMs?: number
  errorScore?: number
}

export function createLLMJudgeScorer<
  TInput = string,
  TOutput = string,
  TExpected = TOutput,
>(
  opts: LLMJudgeScorerOpts<TInput, TOutput, TExpected>,
): Scorer<TInput, TOutput, TExpected> {
  return {
    name: opts.name,
    description: opts.description,
    kind: "judge",
    scorer: async (input) => {
      const maxRetries = opts.retries ?? 2
      const baseDelay = opts.retryDelayMs ?? 1000

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await opts.judge(input)
        } catch (error) {
          if (attempt === maxRetries) {
            return {
              score: opts.errorScore ?? 0,
              metadata: {
                error:
                  error instanceof Error ? error.message : String(error),
                retriesExhausted: true,
                attempts: attempt + 1,
              },
            }
          }
          await sleep(baseDelay * 2 ** attempt)
        }
      }
      return { score: opts.errorScore ?? 0 }
    },
  }
}

// ---------------------------------------------------------------------------
// wrapAutoeval — adapter for autoevals functions (e.g., Factuality)
// ---------------------------------------------------------------------------

interface WrapAutoevalOpts {
  name: string
  description?: string
  autoeval: (args: {
    input: string
    output: string
    expected?: string
  }) => Promise<{ score: number | null; metadata?: Record<string, unknown> }>
  normalizeScore?: (
    raw: number,
    metadata?: Record<string, unknown>,
  ) => number
  retries?: number
  retryDelayMs?: number
}

export function wrapAutoeval(
  opts: WrapAutoevalOpts,
): Scorer<string, string, string> {
  return createLLMJudgeScorer<string, string, string>({
    name: opts.name,
    description: opts.description,
    retries: opts.retries,
    retryDelayMs: opts.retryDelayMs,
    judge: async ({ input, output, expected }) => {
      const result = await opts.autoeval({
        input: String(input),
        output: String(output),
        expected: expected != null ? String(expected) : undefined,
      })

      const rawScore = result.score ?? 0
      const score = opts.normalizeScore
        ? opts.normalizeScore(rawScore, result.metadata)
        : rawScore

      return { score, metadata: result.metadata }
    },
  })
}

// ---------------------------------------------------------------------------
// Semantic helpers — require `ai` and `zod` peer dependencies
// ---------------------------------------------------------------------------

interface SemanticMatchOpts {
  model: any // LanguageModelV1
  threshold?: number
}

export function SemanticMatch(
  opts: SemanticMatchOpts,
): Scorer<string, string, string> {
  return createLLMJudgeScorer<string, string, string>({
    name: "SemanticMatch",
    description: "LLM judge: semantic similarity between output and expected",
    judge: async ({ output, expected }) => {
      const [{ generateObject }, { z }] = await loadAiDeps()
      const threshold = opts.threshold ?? 0.7

      const { object } = await generateObject({
        model: opts.model,
        schema: z.object({
          score: z
            .number()
            .min(0)
            .max(1)
            .describe("Semantic similarity 0-1"),
          rationale: z.string().describe("Brief explanation"),
        }),
        prompt: [
          "Rate the semantic similarity between these two texts on a 0-1 scale.",
          "1.0 means identical meaning, 0.0 means completely unrelated.",
          "",
          `Expected: ${String(expected)}`,
          "",
          `Actual: ${String(output)}`,
        ].join("\n"),
      })

      return {
        score: object.score >= threshold ? 1 : object.score,
        metadata: {
          rawScore: object.score,
          rationale: object.rationale,
          threshold,
        },
      }
    },
  })
}

interface MatchesIntentOpts {
  model: any // LanguageModelV1
  intent: string
}

export function MatchesIntent(
  opts: MatchesIntentOpts,
): Scorer<string, string> {
  return createLLMJudgeScorer<string, string>({
    name: "MatchesIntent",
    description: `LLM judge: output matches intent "${opts.intent}"`,
    judge: async ({ output }) => {
      const [{ generateObject }, { z }] = await loadAiDeps()

      const { object } = await generateObject({
        model: opts.model,
        schema: z.object({
          score: z
            .number()
            .min(0)
            .max(1)
            .describe("How well the output matches the intent, 0-1"),
          rationale: z.string().describe("Brief explanation"),
        }),
        prompt: [
          "Does the following output match the stated intent?",
          "",
          `Intent: ${opts.intent}`,
          "",
          `Output: ${String(output)}`,
          "",
          "Score 1.0 if it fully matches, 0.0 if completely unrelated.",
        ].join("\n"),
      })

      return { score: object.score, metadata: { rationale: object.rationale } }
    },
  })
}

interface SemanticContainsOpts {
  model: any // LanguageModelV1
  concepts: string[]
}

export function SemanticContains(
  opts: SemanticContainsOpts,
): Scorer<string, string> {
  return createLLMJudgeScorer<string, string>({
    name: "SemanticContains",
    description: `LLM judge: output contains concepts [${opts.concepts.join(", ")}]`,
    judge: async ({ output }) => {
      const [{ generateObject }, { z }] = await loadAiDeps()

      const { object } = await generateObject({
        model: opts.model,
        schema: z.object({
          found: z
            .array(z.string())
            .describe("Concepts found in the output"),
          missing: z
            .array(z.string())
            .describe("Concepts not found in the output"),
          rationale: z.string().describe("Brief explanation"),
        }),
        prompt: [
          "Check if the following output contains each of these concepts (semantically, not literally).",
          "",
          `Concepts: ${opts.concepts.join(", ")}`,
          "",
          `Output: ${String(output)}`,
        ].join("\n"),
      })

      const total = opts.concepts.length
      const score = total > 0 ? object.found.length / total : 1

      return {
        score,
        metadata: {
          found: object.found,
          missing: object.missing,
          rationale: object.rationale,
        },
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

let _aiDeps: Promise<[typeof import("ai"), typeof import("zod")]> | undefined

function loadAiDeps(): Promise<
  [typeof import("ai"), typeof import("zod")]
> {
  if (!_aiDeps) {
    _aiDeps = Promise.all([import("ai"), import("zod")])
  }
  return _aiDeps
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
