import { createScorer, evalSuite } from "@goodit/evals"
import { Factuality } from "autoevals"
import { generateCountryBriefing } from "./country-briefing"

interface BriefingExpected {
  reference: string
  requiredTerms: string[]
}

const FACTUALITY_CHOICE_MEANINGS = {
  A: "Submission is a subset of expert answer and fully consistent",
  B: "Submission is a superset of expert answer and fully consistent",
  C: "Submission matches all expert details",
  D: "Submission disagrees with expert answer",
  E: "Differences do not affect factuality",
} as const

const FactualityScorer = createScorer<string, string, BriefingExpected>({
  name: "Factuality",
  description:
    "LLM judge: factual consistency against reference briefing (allows extra consistent facts)",
  scorer: async ({ input, output, expected }) => {
    const reference = expected?.reference
    if (!reference) {
      return {
        score: 0,
        metadata: { error: "Missing expected.reference for Factuality scorer" },
      }
    }

    try {
      const result = await Factuality({
        input: `Country briefing request for: ${input}`,
        output,
        expected: reference,
      })
      const rawMetadata =
        typeof result.metadata === "object" && result.metadata
          ? (result.metadata as { choice?: unknown; rationale?: unknown })
          : {}
      const choice =
        typeof rawMetadata.choice === "string" ? rawMetadata.choice : undefined
      const choiceMeaning =
        choice &&
        choice in FACTUALITY_CHOICE_MEANINGS &&
        FACTUALITY_CHOICE_MEANINGS[
          choice as keyof typeof FACTUALITY_CHOICE_MEANINGS
        ]
      const rawScore = result.score ?? 0
      // For this example, consistent supersets are considered fully acceptable.
      const normalizedScore = choice === "B" ? 1 : rawScore

      return {
        score: normalizedScore,
        metadata: {
          ...rawMetadata,
          rawScore,
          normalizedScore,
          choiceMeaning,
          scoreInterpretation:
            "Raw rubric: 1.00=C/E, 0.60=B, 0.40=A, 0.00=D. This example normalizes B to 1.00.",
        },
      }
    } catch (error) {
      return {
        score: 0,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
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
