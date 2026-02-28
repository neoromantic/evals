import { openai } from "@ai-sdk/openai"
import { traceModel } from "@goodit/evals"
import { generateText } from "ai"

export async function getCapital(country: string): Promise<string> {
  const { text } = await generateText({
    model: traceModel(openai("gpt-4o-mini")),
    prompt: `What is the capital of ${country}? Answer with just the city name, nothing else.`,
  })
  return text.trim()
}
