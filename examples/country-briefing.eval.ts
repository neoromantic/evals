import { createLLMJudgeScorer, createScorer, evalSuite } from "@goodit/evals"
import { Factuality } from "autoevals"
import { generateCountryBriefing } from "./country-briefing"

interface BriefingExpected {
  reference: string
  requiredTerms: string[]
}

const FactualityScorer = createLLMJudgeScorer<
  string,
  string,
  BriefingExpected
>({
  name: "Factuality",
  description:
    "LLM judge: factual consistency against reference briefing (allows extra consistent facts)",
  judge: async ({ input, output, expected }) => {
    const reference = expected?.reference
    if (!reference) {
      return { score: 0, metadata: { error: "Missing expected.reference" } }
    }

    const result = await Factuality({
      input: `Country briefing request for: ${input}`,
      output,
      expected: reference,
    })

    const rawScore = result.score ?? 0
    const choice = (result.metadata as any)?.choice as string | undefined
    // Consistent supersets (choice B) are fully acceptable for this task
    const score = choice === "B" ? 1 : rawScore

    return { score, metadata: { ...result.metadata, rawScore } }
  },
})

const RequiredFactsCoverage = createScorer<string, string, BriefingExpected>({
  name: "RequiredFactsCoverage",
  description:
    "Checks whether core facts (capital/language/currency) are present",
  scorer: ({ output, expected }) => {
    const terms = expected?.requiredTerms ?? []
    if (terms.length === 0) {
      return {
        score: 0,
        metadata: {
          requiredTerms: [],
          matchedTerms: [],
          missingTerms: [],
        },
      }
    }

    const normalizedOutput = normalizeForContains(output)
    const matchedTerms = terms.filter((term) =>
      normalizedOutput.includes(normalizeForContains(term)),
    )
    const missingTerms = terms.filter((term) => !matchedTerms.includes(term))

    return {
      score: matchedTerms.length / terms.length,
      metadata: {
        requiredTerms: terms,
        matchedTerms,
        missingTerms,
      },
    }
  },
})

function normalizeForContains(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

evalSuite("Country Briefings (LLM Scored)", {
  data: () => [
    {
      input: "France",
      expected: {
        reference:
          "Capital: Paris\n" +
          "Official language: French\n" +
          "Currency: Euro\n" +
          "One notable fact: France is a founding member of the European Union.",
        requiredTerms: ["Paris", "French", "Euro"],
      },
    },
    {
      input: "Japan",
      expected: {
        reference:
          "Capital: Tokyo\n" +
          "Official language: Japanese\n" +
          "Currency: Japanese yen\n" +
          "One notable fact: Japan is an island nation in East Asia.",
        requiredTerms: ["Tokyo", "Japanese", "yen"],
      },
    },
    {
      input: "Brazil",
      expected: {
        reference:
          "Capital: Brasilia\n" +
          "Official language: Portuguese\n" +
          "Currency: Brazilian real\n" +
          "One notable fact: Brazil is the largest country in South America.",
        requiredTerms: ["Brasilia", "Portuguese", "real"],
      },
    },
  ],
  task: async (input: string) => {
    return await generateCountryBriefing(input)
  },
  scorers: [RequiredFactsCoverage, FactualityScorer],
  passThreshold: 0.6,
})
