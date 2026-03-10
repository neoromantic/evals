import { openai } from "@ai-sdk/openai"
import {
  createScorer,
  ExactMatch,
  evalSuite,
  SemanticMatch,
  traceModel,
} from "@goodit/evals"
import { getCapital } from "./capitals"

evalSuite("Country Capitals", {
  data: () => [
    { input: "France", expected: "Paris" },
    { input: "Germany", expected: "Berlin" },
    { input: "Japan", expected: "Tokyo" },
    { input: "Brazil", expected: "Brasília" },
    { input: "Australia", expected: "Canberra" },
    { input: "Myanmar", expected: "Naypyidaw" },
    { input: "Kazakhstan", expected: "Astana" },
  ],
  task: async (input: string) => {
    return await getCapital(input)
  },
  scorers: [
    ExactMatch,
    createScorer({
      name: "Case Insensitive Match",
      scorer: ({ output, expected }) =>
        output.toLowerCase() === (expected ?? "").toLowerCase() ? 1 : 0,
    }),
    createScorer({
      name: "Contains Expected",
      description: "Output contains the expected capital somewhere",
      scorer: ({ output, expected }) =>
        output.toLowerCase().includes((expected ?? "").toLowerCase()) ? 1 : 0,
    }),
    SemanticMatch({
      model: traceModel(openai("gpt-4o-mini")),
      threshold: 0.8,
    }),
  ],
})
