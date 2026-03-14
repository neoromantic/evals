import { collector } from "./collector"
import type { MeasureContext, MeasureResult, SuiteConfig } from "./types"

export async function measure<T>(
  fn: (m: MeasureContext) => Promise<T>,
): Promise<MeasureResult<T>> {
  const start = performance.now()
  let error = false
  let taskEndTimestamp: number | undefined

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
    taskEnd() {
      if (!taskEndTimestamp) {
        taskEndTimestamp = performance.now()
      }
    },
  }

  let result: T
  let end = 0
  try {
    result = await fn(ctx)
  } catch (err) {
    error = true
    collector.setTestPassed(false)
    throw err // Re-throw so bun test catches it
  } finally {
    end = performance.now()

    if (taskEndTimestamp) {
      collector.recordMetric("latency", taskEndTimestamp - start, "ms")
      collector.recordMetric("latency.scoring", end - taskEndTimestamp, "ms")
      collector.recordMetric("latency.total", end - start, "ms")
    } else {
      collector.recordMetric("latency", end - start, "ms")
    }

    if (error) {
      collector.recordMetric("error", 1)
    }
  }

  return {
    result,
    metrics: {
      latency: end - start,
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
