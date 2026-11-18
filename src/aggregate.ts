import type { AggregationEntry, SuiteConfig, TestMetrics } from "./types";

type MetricKind = "latency" | "throughput" | "tokens" | "score" | "error" | "unknown";

function classifyMetric(name: string) {
  if (name === "latency" || name.startsWith("latency.") || name.startsWith("ttfb"))
    return "latency";
  if (name.startsWith("throughput")) return "throughput";
  if (name.startsWith("tokens.")) return "tokens";
  if (name.startsWith("score.")) return "score";
  if (name === "error") return "error";
  return "unknown";
}

function weightedAvg(entries: AggregationEntry[]) {
  let sumWeighted = 0;
  let sumWeights = 0;
  for (const e of entries) {
    sumWeighted += e.value * e.weight;
    sumWeights += e.weight;
  }
  return sumWeights === 0 ? 0 : sumWeighted / sumWeights;
}

function sum(entries: AggregationEntry[]) {
  let total = 0;
  for (const e of entries) {
    total += e.value;
  }
  return total;
}

function min(entries: AggregationEntry[]) {
  let result = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    if (e.value < result) result = e.value;
  }
  return result;
}

function max(entries: AggregationEntry[]) {
  let result = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    if (e.value > result) result = e.value;
  }
  return result;
}

function percentile(entries: AggregationEntry[], p: number) {
  if (entries.length === 0) return 0;
  const sorted = entries.map((e) => e.value).sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const fraction = index - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

function collectNumericMetricNames(tests: TestMetrics[]) {
  const metricNames = new Set<string>();
  for (const test of tests) {
    for (const [metricName, metricValue] of Object.entries(test.metrics)) {
      if (typeof metricValue === "number") {
        metricNames.add(metricName);
      }
    }
  }
  return metricNames;
}

function entriesForMetric(tests: TestMetrics[], metricName: string) {
  const entries: AggregationEntry[] = [];
  for (const test of tests) {
    const metricValue = test.metrics[metricName];
    if (typeof metricValue === "number") {
      entries.push({ value: metricValue, weight: test.weight });
    }
  }
  return entries;
}

type AggOp = "sum" | "avg" | "min" | "max" | "p50" | "p95" | "count" | "rate";

function aggregationsForKind(kind: MetricKind) {
  switch (kind) {
    case "latency":
      return ["sum", "avg", "min", "max", "p50", "p95"] satisfies AggOp[];
    case "throughput":
      return ["avg"] satisfies AggOp[];
    case "tokens":
      return ["sum", "avg", "min", "max", "p50", "p95"] satisfies AggOp[];
    case "score":
      return ["avg", "min", "max", "p50", "p95"] satisfies AggOp[];
    case "error":
      return ["count", "rate"] satisfies AggOp[];
    default:
      return [] satisfies AggOp[];
  }
}

function computeAgg(op: AggOp, entries: AggregationEntry[]) {
  switch (op) {
    case "sum":
    case "count":
      return sum(entries);
    case "avg":
    case "rate":
      return weightedAvg(entries);
    case "min":
      return min(entries);
    case "max":
      return max(entries);
    case "p50":
      return percentile(entries, 50);
    case "p95":
      return percentile(entries, 95);
  }
}

function buildPassEntries(tests: TestMetrics[], passThreshold: number) {
  return tests.map((test) => {
    if (!test.passed) {
      return { value: 0, weight: test.weight };
    }

    let hasScoreMetric = false;
    let passed = true;

    for (const [metricName, metricValue] of Object.entries(test.metrics)) {
      if (!metricName.startsWith("score.") || typeof metricValue !== "number") {
        continue;
      }

      hasScoreMetric = true;
      if (metricValue < passThreshold) {
        passed = false;
        break;
      }
    }

    return {
      value: !hasScoreMetric || passed ? 1 : 0,
      weight: test.weight,
    };
  });
}

export function aggregateMetrics(tests: TestMetrics[], suiteConfig?: SuiteConfig) {
  const result: Record<string, number> = {};

  if (tests.length === 0) {
    result["test.count"] = 0;
    result["test.pass_rate"] = 0;
    return result;
  }

  const metricNames = collectNumericMetricNames(tests);

  for (const metric of metricNames) {
    const kind = classifyMetric(metric);
    const ops = aggregationsForKind(kind);

    if (ops.length === 0) continue;

    const entries =
      metric === "error"
        ? tests.map((test) => {
            const errorMetric = test.metrics.error;
            return {
              value: typeof errorMetric === "number" ? errorMetric : 0,
              weight: test.weight,
            };
          })
        : entriesForMetric(tests, metric);

    if (entries.length === 0) continue;

    for (const op of ops) {
      result[`${metric}.${op}`] = computeAgg(op, entries);
    }
  }

  result["test.count"] = tests.length;

  const passThreshold = suiteConfig?.passThreshold ?? 0.5;
  const passEntries = buildPassEntries(tests, passThreshold);
  result["test.pass_rate"] = weightedAvg(passEntries);

  if (suiteConfig?.aggregations) {
    for (const [name, aggregationFn] of Object.entries(suiteConfig.aggregations)) {
      const metricKey = name.includes(".") ? name.split(".").slice(0, -1).join(".") : name;
      const entries = entriesForMetric(tests, metricKey);
      result[name] = aggregationFn(entries);
    }
  }

  return result;
}
