import { openai } from "@ai-sdk/openai"
import { traceModel } from "@goodit/evals"
import { generateText } from "ai"

export async function generateCountryBriefing(
  country: string,
): Promise<string> {
  const prompt = [
    "You are a factual research assistant.",
    `Write a 4-line briefing about ${country}.`,
    "Use exactly this format:",
    "Capital: ...",
    "Official language: ...",
    "Currency: ...",
    "One notable fact: ...",
    "Do not include extra lines or commentary.",
    "If uncertain, state only high-confidence facts.",
  ].join("\n")

  const { text } = await generateText({
    model: traceModel(openai("gpt-4o-mini")),
    prompt,
  })

  return text.trim()
}
