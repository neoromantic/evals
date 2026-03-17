import { createOpenAI } from "@ai-sdk/openai"
import { gateway, generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { ScorerResult } from "./types"

export interface FactsCheck {
  __check: "facts"
  facts: string[]
  model?: LanguageModel
}

export function Facts(
  facts: string[],
  opts?: { model?: LanguageModel },
): FactsCheck {
  return { __check: "facts", facts, model: opts?.model }
}

export function isFactsCheck(value: unknown): value is FactsCheck {
  return (
    typeof value === "object" &&
    value !== null &&
    "__check" in value &&
    (value as FactsCheck).__check === "facts"
  )
}

function getDefaultJudgeModel(): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) {
    return gateway("openai/gpt-4o-mini")
  }

  if (process.env.OPENAI_API_KEY) {
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(
      "gpt-4o-mini",
    )
  }

  throw new Error(
    "No model available for Facts() scorer. " +
      "Set AI_GATEWAY_API_KEY or OPENAI_API_KEY.",
  )
}

async function judgeFact(
  ctx: { input: unknown; output: unknown; fact: string },
  model?: LanguageModel,
): Promise<ScorerResult> {
  const { object } = await generateObject({
    model: model ?? getDefaultJudgeModel(),
    schema: z.object({
      score: z
        .number()
        .min(0)
        .max(1)
        .describe("How well the fact is supported, 0-1"),
      rationale: z.string().describe("Brief explanation"),
    }),
    prompt: [
      "You are evaluating whether a stated fact is supported by the given output.",
      "",
      `Input context: ${JSON.stringify(ctx.input)}`,
      "",
      `Output to evaluate: ${JSON.stringify(ctx.output)}`,
      "",
      `Fact to verify: ${ctx.fact}`,
      "",
      "Score 1.0 if the fact is clearly supported by the output.",
      "Score 0.0 if the fact is contradicted or not supported at all.",
      "Score between 0 and 1 for partial support.",
    ].join("\n"),
  })

  return {
    score: object.score,
    name: ctx.fact.length > 60 ? `${ctx.fact.slice(0, 57)}...` : ctx.fact,
    metadata: { rationale: object.rationale, fact: ctx.fact },
    kind: "judge",
  }
}

export async function resolveCheckScorers(
  expected: unknown,
  input: unknown,
  output: unknown,
): Promise<ScorerResult[]> {
  if (isFactsCheck(expected)) {
    return Promise.all(
      expected.facts.map((fact) =>
        judgeFact({ input, output, fact }, expected.model),
      ),
    )
  }

  throw new Error(
    "Cannot derive scorers: expected is not a recognized check type. " +
      "Use Facts([...]) or provide explicit scorers.",
  )
}
