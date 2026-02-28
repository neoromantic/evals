import { collector } from "./collector"
import type { MeasureContext, MeasureResult, SuiteConfig } from "./types"

export async function measure<T>(
  fn: (m: MeasureContext) => Promise<T>,
): Promise<MeasureResult<T>> {
  const start = performance.now()
  let error = false

  const ctx: MeasureContext = {
    metric(name, value, unit) {
      collector.recordMetric(name, value, unit)
    },
    score(name, value) {
      collector.recordScore(name, value)
    },
    tokens(usage) {
      collector.recordTokens(usage)
    },
    weight(w) {
      collector.setWeight(w)
    },
  }

  let result: T
  try {
    result = await fn(ctx)
  } catch (err) {
    error = true
    collector.recordMetric("error", 1)
    collector.setTestPassed(false)
    throw err // Re-throw so bun test catches it
  } finally {
    const latency = performance.now() - start
    collector.recordMetric("latency", latency, "ms")
    if (error) {
      collector.recordMetric("error", 1)
    }
  }

  return {
    result,
    metrics: {
      latency: performance.now() - start,
      error,
    },
  }
}

export function score(name: string, value: number): void {
  collector.recordScore(name, value)
}

export function suite(name: string, config: SuiteConfig): void {
  collector.configureSuite(name, config)
}
