import { AsyncLocalStorage } from "node:async_hooks"
import type { ScorerResult, SuiteConfig, TestMetrics } from "./types"

class Collector {
  private suiteConfigs: Map<string, SuiteConfig> = new Map()
  private suiteNames: Map<string, string> = new Map()
  private testResults: TestMetrics[] = []
  private evalFiles: Map<string, string> = new Map()
  private currentEntryStorage: AsyncLocalStorage<TestMetrics> =
    new AsyncLocalStorage()
  private legacyCurrentEntry: TestMetrics | null = null

  // --- Suite configuration ---

  registerSuite(
    suiteName: string,
    config: SuiteConfig,
    evalFilePath?: string,
  ): string {
    const suiteKey = this.createSuiteKey(suiteName, evalFilePath)
    this.suiteConfigs.set(suiteKey, config)
    this.suiteNames.set(suiteKey, suiteName)
    if (evalFilePath) {
      this.evalFiles.set(suiteKey, evalFilePath)
    }
    return suiteKey
  }

  configureSuite(name: string, config: SuiteConfig): void {
    this.suiteConfigs.set(name, config)
    this.suiteNames.set(name, name)
  }

  getSuiteConfig(suiteKey: string): SuiteConfig | undefined {
    return this.suiteConfigs.get(suiteKey)
  }

  getSuiteName(suiteKey: string): string | undefined {
    return this.suiteNames.get(suiteKey)
  }

  // --- Eval file tracking ---

  setEvalFile(suiteKey: string, filePath: string): void {
    this.evalFiles.set(suiteKey, filePath)
  }

  getEvalFile(suiteKey: string): string | undefined {
    return this.evalFiles.get(suiteKey)
  }

  // --- Test lifecycle ---

  beginTest(
    suiteKeyOrName: string,
    suiteNameOrTestName: string,
    maybeTestName?: string,
  ): void {
    const suiteKey = suiteKeyOrName
    const suiteName = maybeTestName ? suiteNameOrTestName : suiteKeyOrName
    const testName = maybeTestName ?? suiteNameOrTestName

    const entry = this.createTestEntry(suiteKey, suiteName, testName)
    this.testResults.push(entry)
    this.legacyCurrentEntry = entry
  }

  async runTest<T>(
    suiteKey: string,
    suiteName: string,
    testName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const entry = this.createTestEntry(suiteKey, suiteName, testName)
    this.testResults.push(entry)

    return await this.currentEntryStorage.run(entry, async () => {
      return await fn()
    })
  }

  endTest(): void {
    this.legacyCurrentEntry = null
  }

  // --- Metric recording ---

  recordMetric(name: string, value: number, _unit?: string): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.metrics[name] = value
  }

  recordScore(name: string, value: number): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.metrics[`score.${name}`] = value
  }

  recordTokens(usage: {
    promptTokens: number
    completionTokens: number
    totalTokens?: number
  }): void {
    const entry = this.currentEntry()
    if (!entry) return
    const currentInput = numberMetric(entry.metrics["tokens.input"])
    const currentOutput = numberMetric(entry.metrics["tokens.output"])
    const currentTotal = numberMetric(entry.metrics["tokens.total"])
    const nextTotal =
      usage.totalTokens ?? usage.promptTokens + usage.completionTokens

    entry.metrics["tokens.input"] = currentInput + usage.promptTokens
    entry.metrics["tokens.output"] = currentOutput + usage.completionTokens
    entry.metrics["tokens.total"] = currentTotal + nextTotal
  }

  setWeight(weight: number): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.weight = weight
  }

  setTestPassed(passed: boolean): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.passed = passed
  }

  setTestContext(context: {
    input: unknown
    output: unknown
    expected?: unknown
  }): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.input = context.input
    entry.output = context.output
    entry.expected = context.expected
  }

  addScorerResult(result: ScorerResult): void {
    const entry = this.currentEntry()
    if (!entry) return
    entry.scorerResults.push(result)
  }

  // --- Query ---

  getTestResults(): TestMetrics[] {
    return this.testResults
  }

  getTestResultsForSuite(suiteKey: string): TestMetrics[] {
    return this.testResults.filter((test) => test.suiteKey === suiteKey)
  }

  getSuiteKeys(): string[] {
    return [...new Set(this.testResults.map((test) => test.suiteKey))]
  }

  getSuiteNames(): string[] {
    return this.getSuiteKeys()
      .map((suiteKey) => this.suiteNames.get(suiteKey) ?? suiteKey)
      .filter((suiteName) => suiteName.length > 0)
  }

  // --- Reset ---

  reset(): void {
    this.suiteConfigs.clear()
    this.suiteNames.clear()
    this.testResults = []
    this.evalFiles.clear()
    this.legacyCurrentEntry = null
  }

  // --- Internal ---

  private currentEntry(): TestMetrics | null {
    const activeEntry = this.currentEntryStorage.getStore()
    if (activeEntry) return activeEntry

    if (this.legacyCurrentEntry) {
      return this.legacyCurrentEntry
    }

    console.warn(
      "[@goodit/evals] No active test — call beginTest() before recording metrics",
    )
    return null
  }

  private createSuiteKey(suiteName: string, evalFilePath?: string): string {
    const identity = evalFilePath ?? "<unknown>"
    const baseKey = `${identity}::${suiteName}`
    if (!this.suiteConfigs.has(baseKey)) {
      return baseKey
    }

    let suffix = 2
    let candidate = `${baseKey}#${suffix}`
    while (this.suiteConfigs.has(candidate)) {
      suffix += 1
      candidate = `${baseKey}#${suffix}`
    }

    return candidate
  }

  private createTestEntry(
    suiteKey: string,
    suiteName: string,
    testName: string,
  ): TestMetrics {
    return {
      suiteKey,
      suiteName,
      testName,
      metrics: {},
      weight: 1,
      passed: true,
      scorerResults: [],
    }
  }
}

function numberMetric(value: number | boolean | undefined): number {
  return typeof value === "number" ? value : 0
}

export const collector = new Collector()
export type { Collector }
