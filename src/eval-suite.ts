import { describe, test } from "bun:test"
import { collector } from "./collector"
import { measure } from "./measure"
import type { EvalData, EvalSuiteConfig } from "./types"

const ASYNC_SUITE_BUN_TIMEOUT_MULTIPLIER = 1000
const EVAL_STACK_PATH_REGEX =
  /(?:file:\/\/)?((?:\/|[A-Za-z]:[\\/])[^:\n]+?\.eval\.(?:ts|js))(?::\d+:\d+)?/

// Variant config for evalSuite.each()
interface VariantEvalSuiteConfig<TInput, TOutput, TExpected, TVariant>
  extends Omit<EvalSuiteConfig<TInput, TOutput, TExpected>, "task"> {
  task: (input: TInput, variant: TVariant) => Promise<TOutput>
}

function evalSuiteImpl<TInput = string, TOutput = string, TExpected = TOutput>(
  name: string,
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
): void {
  const passThreshold = config.passThreshold ?? 0.5
  const timeout = config.timeout ?? 30_000
  const detectedEvalFile = detectEvalFileFromStack(new Error().stack ?? "")

  const suiteKey = collector.registerSuite(
    name,
    {
      passThreshold,
      aggregations: config.aggregations,
    },
    detectedEvalFile,
  )

  if (detectedEvalFile) {
    collector.setEvalFile(suiteKey, detectedEvalFile)
  }

  const rawData = config.data

  if (Array.isArray(rawData)) {
    registerTests(suiteKey, name, rawData, config, passThreshold, timeout)
    return
  }

  if (isAsyncFunction(rawData)) {
    registerFunctionDataSuite(
      suiteKey,
      name,
      rawData,
      config,
      passThreshold,
      timeout,
    )
    return
  }

  const providedData = safelyCallDataProvider(rawData)
  if ("error" in providedData) {
    registerDataPromiseSuite(
      suiteKey,
      name,
      Promise.reject(providedData.error),
      config,
      passThreshold,
      timeout,
    )
    return
  }

  if (Array.isArray(providedData.value)) {
    registerTests(
      suiteKey,
      name,
      providedData.value,
      config,
      passThreshold,
      timeout,
    )
    return
  }

  if (isPromiseLike(providedData.value)) {
    registerDataPromiseSuite(
      suiteKey,
      name,
      toGuardedPromise(providedData.value),
      config,
      passThreshold,
      timeout,
    )
    return
  }

  registerDataPromiseSuite(
    suiteKey,
    name,
    Promise.reject(
      new Error(
        `Eval suite "${name}" data provider must return an array or a promise of an array`,
      ),
    ),
    config,
    passThreshold,
    timeout,
  )
}

// ---------------------------------------------------------------------------
// evalSuite.each() — variant support
// ---------------------------------------------------------------------------

function evalSuiteEach<TVariant extends { name: string }>(
  variants: TVariant[],
) {
  return <TInput = string, TOutput = string, TExpected = TOutput>(
    name: string,
    config: VariantEvalSuiteConfig<TInput, TOutput, TExpected, TVariant>,
  ): void => {
    for (const variant of variants) {
      const suiteName = `${name} [${variant.name}]`
      evalSuiteImpl<TInput, TOutput, TExpected>(suiteName, {
        ...config,
        task: (input: TInput) => config.task(input, variant),
      })
    }
  }
}

// Export as a function with .each property
export const evalSuite = Object.assign(evalSuiteImpl, {
  each: evalSuiteEach,
})

export function detectEvalFileFromStack(stack: string): string | undefined {
  for (const line of stack.split("\n")) {
    if (!line.includes(".eval.ts") && !line.includes(".eval.js")) {
      continue
    }

    const pathMatch = line.match(EVAL_STACK_PATH_REGEX)
    if (pathMatch?.[1]) {
      return pathMatch[1].trim()
    }
  }

  return undefined
}

export function getAsyncSuiteTimeout(
  timeout: number,
  caseCount: number,
): number {
  const safeCaseCount = Number.isFinite(caseCount)
    ? Math.max(1, Math.floor(caseCount))
    : 1

  return timeout * safeCaseCount
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyOnlyFilter<TInput, TExpected>(
  data: EvalData<TInput, TExpected>[],
): EvalData<TInput, TExpected>[] {
  const hasOnly = data.some((d) => d.only)
  return hasOnly ? data.filter((d) => d.only) : data
}

function testLabel<TInput>(item: EvalData<TInput, unknown>): string {
  if (typeof item.name === "string" && item.name.trim().length > 0) {
    return item.name.trim()
  }

  if (typeof item.input === "string") return item.input
  return JSON.stringify(item.input)
}

function registerTests<TInput, TOutput, TExpected>(
  suiteKey: string,
  suiteName: string,
  data: EvalData<TInput, TExpected>[],
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
  passThreshold: number,
  timeout: number,
): void {
  const items = applyOnlyFilter(data)
  const testImpl = getCaseTestImplementation()

  describe(suiteName, () => {
    for (const item of items) {
      testImpl(
        testLabel(item),
        async () => {
          await runSingleEval(suiteKey, suiteName, item, config, passThreshold)
        },
        timeout,
      )
    }
  })
}

type CaseTestFn = (
  label: string,
  callback: () => Promise<void>,
  timeout?: number,
) => void

function getCaseTestImplementation(): CaseTestFn {
  const maybeConcurrent = (test as unknown as { concurrent?: CaseTestFn })
    .concurrent

  return maybeConcurrent ?? test
}

function registerFunctionDataSuite<TInput, TOutput, TExpected>(
  suiteKey: string,
  suiteName: string,
  dataProvider: () =>
    | EvalData<TInput, TExpected>[]
    | Promise<EvalData<TInput, TExpected>[]>,
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
  passThreshold: number,
  timeout: number,
): void {
  registerDataPromiseSuite(
    suiteKey,
    suiteName,
    Promise.resolve().then(dataProvider),
    config,
    passThreshold,
    timeout,
  )
}

function registerDataPromiseSuite<TInput, TOutput, TExpected>(
  suiteKey: string,
  suiteName: string,
  dataPromise: Promise<EvalData<TInput, TExpected>[]>,
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
  passThreshold: number,
  timeout: number,
): void {
  describe(suiteName, () => {
    test(
      "evaluate all",
      async () => {
        const data = await withTimeout(
          dataPromise,
          timeout,
          suiteName,
          "loading data",
        )
        await runDataItemsWithTimeout(
          suiteKey,
          suiteName,
          data,
          config,
          passThreshold,
          timeout,
        )
      },
      timeout * ASYNC_SUITE_BUN_TIMEOUT_MULTIPLIER,
    )
  })
}

async function runDataItemsWithTimeout<TInput, TOutput, TExpected>(
  suiteKey: string,
  suiteName: string,
  data: EvalData<TInput, TExpected>[],
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
  passThreshold: number,
  timeout: number,
): Promise<void> {
  const items = applyOnlyFilter(data)
  const asyncSuiteTimeout = getAsyncSuiteTimeout(timeout, items.length)

  await withTimeout(
    Promise.all(
      items.map((item) =>
        runSingleEval(suiteKey, suiteName, item, config, passThreshold),
      ),
    ).then(() => undefined),
    asyncSuiteTimeout,
    suiteName,
    "running cases",
  )
}

function isAsyncFunction<TInput, TExpected>(
  dataProvider: () =>
    | EvalData<TInput, TExpected>[]
    | Promise<EvalData<TInput, TExpected>[]>,
): boolean {
  return dataProvider.constructor.name === "AsyncFunction"
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  )
}

function safelyCallDataProvider<TInput, TExpected>(
  dataProvider: () =>
    | EvalData<TInput, TExpected>[]
    | Promise<EvalData<TInput, TExpected>[]>,
):
  | {
      value:
        | EvalData<TInput, TExpected>[]
        | Promise<EvalData<TInput, TExpected>[]>
    }
  | { error: unknown } {
  try {
    return { value: dataProvider() }
  } catch (error) {
    return { error }
  }
}

function toGuardedPromise<T>(value: Promise<T>): Promise<T> {
  return value.then(
    (resolved) => resolved,
    (error) => {
      throw error
    },
  )
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  suiteName: string,
  phase?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const phaseSuffix = phase ? ` while ${phase}` : ""
      reject(
        new Error(
          `Eval suite "${suiteName}" timed out after ${timeoutMs}ms${phaseSuffix}`,
        ),
      )
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function runSingleEval<TInput, TOutput, TExpected>(
  suiteKey: string,
  suiteName: string,
  item: EvalData<TInput, TExpected>,
  config: EvalSuiteConfig<TInput, TOutput, TExpected>,
  passThreshold: number,
): Promise<void> {
  const name = testLabel(item)
  const scoreValues: number[] = []

  await collector.runTest(suiteKey, suiteName, name, async () => {
    await measure(async (m) => {
      if (item.weight !== undefined) {
        m.weight(item.weight)
      }

      // Run the task
      const output = await config.task(item.input)
      collector.setTestContext({
        input: item.input,
        output,
        expected: item.expected,
      })

      // Run each scorer and record results
      for (const scorer of config.scorers) {
        const rawResult = await scorer.scorer({
          input: item.input,
          output: output as TOutput,
          expected: item.expected,
        })

        let scoreValue: number
        let metadata: unknown

        if (typeof rawResult === "number") {
          scoreValue = rawResult
        } else {
          scoreValue = rawResult.score
          metadata = rawResult.metadata
        }

        scoreValues.push(scoreValue)
        m.score(scorer.name, scoreValue)

        collector.addScorerResult({
          name: scorer.name,
          score: scoreValue,
          description: scorer.description,
          metadata,
        })
      }

      // A test passes when every scorer >= threshold.
      if (scoreValues.some((scoreValue) => scoreValue < passThreshold)) {
        collector.setTestPassed(false)
      }

      return output
    })
  })
}
