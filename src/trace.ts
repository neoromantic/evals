import { AsyncLocalStorage } from "node:async_hooks"
import { collector } from "./collector"
import type { TraceEntry } from "./types"

const traceStorage = new AsyncLocalStorage<TraceEntry[]>()

/** Extract a plain number from AI SDK token counts (handles both number and {total} object) */
function tokenCount(v: unknown): number {
  if (typeof v === "number") return v
  if (v && typeof v === "object" && "total" in v) return (v as any).total
  return 0
}

export function reportTrace(entry: TraceEntry): void {
  const traces = traceStorage.getStore()
  if (traces) {
    traces.push(entry)
  }

  if (entry.usage) {
    collector.recordTokens({
      promptTokens: entry.usage.inputTokens,
      completionTokens: entry.usage.outputTokens,
    })
  }
}

export function traceModel(model: any): any {
  if (process.env.EVAL_TRACE !== "1" && !process.env.EVAL_FILES) {
    return model
  }

  try {
    const { wrapLanguageModel } = require("ai")

    return wrapLanguageModel({
      model,
      middleware: {
        wrapGenerate: async ({ doGenerate, params }: any) => {
          const start = performance.now()
          const result = await doGenerate()
          const end = performance.now()

          reportTrace({
            start,
            end,
            input: params.prompt,
            output: result.text ?? result.toolCalls,
            usage: result.usage
              ? {
                  inputTokens: tokenCount(result.usage.inputTokens),
                  outputTokens: tokenCount(result.usage.outputTokens),
                }
              : undefined,
          })

          return result
        },
        wrapStream: async ({ doStream, params }: any) => {
          const start = performance.now()
          const { stream, ...rest } = await doStream()

          let inputTokens = 0
          let outputTokens = 0
          let text = ""

          const transformStream = new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk)

              if (chunk.type === "text-delta") {
                text += chunk.textDelta
              }
              if (chunk.type === "finish") {
                if (chunk.usage) {
                  inputTokens = tokenCount(chunk.usage.inputTokens)
                  outputTokens = tokenCount(chunk.usage.outputTokens)
                }

                reportTrace({
                  start,
                  end: performance.now(),
                  input: params.prompt,
                  output: text,
                  usage: { inputTokens, outputTokens },
                })
              }
            },
          })

          return {
            stream: stream.pipeThrough(transformStream),
            ...rest,
          }
        },
      },
    })
  } catch {
    return model
  }
}

export function runWithTraces<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; traces: TraceEntry[] }> {
  const traces: TraceEntry[] = []
  return traceStorage.run(traces, async () => {
    const result = await fn()
    return { result, traces }
  })
}
