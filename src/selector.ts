import { relative } from "node:path"
import React, { createElement, useEffect, useState } from "react"
import {
  Box,
  Newline,
  Text,
  render,
  useApp,
  useInput,
  useStdin,
  useStdout,
} from "ink"
import type { EvalEstimate, EstimateSummary } from "./estimates"
import { summarizeEvalEstimates } from "./estimates"

export interface SelectionState {
  cursor: number
  selected: boolean[]
}

export interface VisibleWindow {
  start: number
  end: number
}

export type SelectionResult =
  | { kind: "run"; evalFiles: string[] }
  | { kind: "cancel" }

export interface SelectEvalFilesInteractiveOptions {
  cwd: string
  evalFiles: string[]
  estimates?: EvalEstimate[]
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
  stderr?: NodeJS.WriteStream
}

interface EvalFileEntry {
  file: string
  label: string
  estimate: EvalEstimate
}

interface SelectorAppProps {
  entries: EvalFileEntry[]
}

function normalizeItemCount(itemCount: number): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) {
    return 0
  }

  return Math.floor(itemCount)
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : `${" ".repeat(width - value.length)}${value}`
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`
}

function truncateEnd(value: string, width: number): string {
  if (width <= 1) {
    return value.slice(0, width)
  }

  if (value.length <= width) {
    return value
  }

  return `${value.slice(0, width - 1)}…`
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return "--"
  }

  if (ms >= 60_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = (ms % 60_000) / 1000
    return `${minutes}m ${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  }

  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`
  }

  return `${Math.round(ms)}ms`
}

function formatDurationRange(
  lowerBoundMs: number | null,
  upperBoundMs: number | null,
): string {
  if (lowerBoundMs === null && upperBoundMs === null) {
    return "--"
  }

  const lower = lowerBoundMs ?? upperBoundMs
  const upper = upperBoundMs ?? lowerBoundMs
  if (lower === null || upper === null) {
    return formatDuration(lower ?? upper)
  }

  if (Math.abs(upper - lower) < 100) {
    return formatDuration(Math.max(lower, upper))
  }

  return `${formatDuration(lower)}-${formatDuration(upper)}`
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) {
    return "--"
  }

  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  }

  return `${Math.round(tokens)}`
}

function formatTokenBreakdown(estimate: EvalEstimate): string {
  const { input, output, total } = estimate.tokens
  if (input === null && output === null && total === null) {
    return "--"
  }

  if (input === null && output === null) {
    return `${formatTokens(total)} total`
  }

  return `${formatTokens(total)} total (${formatTokens(input)} in / ${formatTokens(output)} out)`
}

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return "unknown"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "unknown"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function selectedEntries(
  entries: EvalFileEntry[],
  selectionState: SelectionState,
): EvalFileEntry[] {
  return entries.filter((_, index) => selectionState.selected[index])
}

function selectedSummaryText(summary: EstimateSummary): string {
  if (summary.selectedCount === 0) {
    return "0 selected | choose at least one eval file"
  }

  const parts = [`${summary.selectedCount} selected`]

  if (summary.estimatedCount > 0) {
    parts.push(
      `wall ${formatDurationRange(summary.wallLowerBoundMs, summary.wallUpperBoundMs)}`,
    )
    parts.push(`work ${formatDuration(summary.workMs)}`)
    parts.push(`tokens ${formatTokens(summary.tokens.total)}`)
  } else {
    parts.push("no baseline estimates yet")
  }

  if (summary.missingCount > 0) {
    parts.push(`+${summary.missingCount} without baseline`)
  }

  return parts.join(" | ")
}

function listHeader(contentWidth: number): string {
  const prefixWidth = 6
  const wallWidth = 14
  const tokenWidth = 8
  const labelWidth = Math.max(
    12,
    contentWidth - prefixWidth - 1 - wallWidth - 1 - tokenWidth,
  )

  return `${" ".repeat(prefixWidth)}${padRight("Eval file", labelWidth)} ${padLeft("Wall", wallWidth)} ${padLeft("Tokens", tokenWidth)}`
}

function listRow(
  entry: EvalFileEntry,
  isFocused: boolean,
  isSelected: boolean,
  contentWidth: number,
): string {
  const prefix = `${isFocused ? ">" : " "} ${isSelected ? "[x]" : "[ ]"} `
  const wallWidth = 14
  const tokenWidth = 8
  const labelWidth = Math.max(
    12,
    contentWidth - prefix.length - 1 - wallWidth - 1 - tokenWidth,
  )
  const wallLabel = entry.estimate.hasBaseline
    ? formatDurationRange(
        entry.estimate.wallLowerBoundMs,
        entry.estimate.wallUpperBoundMs,
      )
    : "no baseline"
  const tokenLabel = entry.estimate.hasBaseline
    ? formatTokens(entry.estimate.tokens.total)
    : "--"

  return `${prefix}${padRight(truncateEnd(entry.label, labelWidth), labelWidth)} ${padLeft(wallLabel, wallWidth)} ${padLeft(tokenLabel, tokenWidth)}`
}

function suiteHeader(contentWidth: number): string {
  const wallWidth = 8
  const workWidth = 8
  const tokenWidth = 8
  const caseWidth = 5
  const labelWidth = Math.max(
    8,
    contentWidth - labelWidthPadding(wallWidth, workWidth, tokenWidth, caseWidth),
  )

  return `${padRight("Suite", labelWidth)} ${padLeft("Wall", wallWidth)} ${padLeft("Work", workWidth)} ${padLeft("Tokens", tokenWidth)} ${padLeft("Cases", caseWidth)}`
}

function labelWidthPadding(
  wallWidth: number,
  workWidth: number,
  tokenWidth: number,
  caseWidth: number,
): number {
  return wallWidth + workWidth + tokenWidth + caseWidth + 4
}

function suiteRow(
  label: string,
  wallMs: number | null,
  workMs: number | null,
  tokens: number | null,
  testCount: number | null,
  contentWidth: number,
): string {
  const wallWidth = 8
  const workWidth = 8
  const tokenWidth = 8
  const caseWidth = 5
  const labelWidth = Math.max(
    8,
    contentWidth - labelWidthPadding(wallWidth, workWidth, tokenWidth, caseWidth),
  )

  return `${padRight(truncateEnd(label, labelWidth), labelWidth)} ${padLeft(formatDuration(wallMs), wallWidth)} ${padLeft(formatDuration(workMs), workWidth)} ${padLeft(formatTokens(tokens), tokenWidth)} ${padLeft(testCount === null ? "--" : String(Math.round(testCount)), caseWidth)}`
}

function detailsPanel(
  entry: EvalFileEntry,
  contentWidth: number,
): React.ReactNode[] {
  const suiteRows = [...entry.estimate.suites].sort((left, right) => {
    const leftWork = left.workMs ?? Number.NEGATIVE_INFINITY
    const rightWork = right.workMs ?? Number.NEGATIVE_INFINITY
    return rightWork - leftWork
  })

  if (!entry.estimate.hasBaseline) {
    return [
      createElement(Text, { key: "title", bold: true }, "Focused Eval"),
      createElement(Text, { key: "file" }, entry.label),
      createElement(Newline, { key: "gap-0" }),
      createElement(
        Text,
        { key: "missing", color: "yellow" },
        "No saved baseline for this eval file.",
      ),
      createElement(
        Text,
        { key: "hint", dimColor: true },
        "Run it once and save a baseline to populate estimates here.",
      ),
    ]
  }

  const nodes: React.ReactNode[] = [
    createElement(Text, { key: "title", bold: true }, "Focused Eval"),
    createElement(Text, { key: "file" }, entry.label),
    createElement(
      Text,
      { key: "updated", dimColor: true },
      `Baseline updated ${formatUpdatedAt(entry.estimate.baselineUpdatedAt)}`,
    ),
    createElement(Newline, { key: "gap-0" }),
    createElement(
      Text,
      { key: "summary-a" },
      `Wall ${formatDurationRange(
        entry.estimate.wallLowerBoundMs,
        entry.estimate.wallUpperBoundMs,
      )} | Work ${formatDuration(entry.estimate.workMs)}`,
    ),
    createElement(
      Text,
      { key: "summary-b" },
      `Tokens ${formatTokenBreakdown(entry.estimate)} | Cases ${entry.estimate.testCount === null ? "--" : Math.round(entry.estimate.testCount)}`,
    ),
    createElement(Newline, { key: "gap-1" }),
  ]

  if (!entry.estimate.hasDetailedSuites) {
    nodes.push(
      createElement(Text, { key: "suite-title", bold: true }, "Suites"),
      createElement(
        Text,
        { key: "suite-missing", dimColor: true },
        "This baseline only has a file-level aggregate, so suite-level breakdown is unavailable.",
      ),
    )
    return nodes
  }

  nodes.push(
    createElement(Text, { key: "suite-title", bold: true }, "Suite Breakdown"),
    createElement(Text, { key: "suite-header", dimColor: true }, suiteHeader(contentWidth)),
    ...suiteRows.map((suite) =>
      createElement(
        Text,
        { key: suite.key },
        suiteRow(
          suite.label,
          suite.wallMs,
          suite.workMs,
          suite.tokens.total,
          suite.testCount,
          contentWidth,
        ),
      ),
    ),
  )

  return nodes
}

function SelectorApp({ entries }: SelectorAppProps): React.ReactNode {
  const { exit } = useApp()
  const { isRawModeSupported } = useStdin()
  const { stdout } = useStdout()
  const [selectionState, setSelectionState] = useState(() =>
    createSelectionState(entries.length),
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const terminalRows =
    typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : 24
  const terminalColumns =
    typeof stdout.columns === "number" && stdout.columns > 0
      ? stdout.columns
      : 120
  const isWideLayout = terminalColumns >= 110
  const listPanelWidth = isWideLayout
    ? Math.max(48, Math.floor(terminalColumns * 0.56))
    : terminalColumns
  const detailsPanelWidth = isWideLayout
    ? Math.max(34, terminalColumns - listPanelWidth - 1)
    : terminalColumns
  const visibleWindow = getVisibleWindow(
    selectionState.cursor,
    entries.length,
    terminalRows - (isWideLayout ? 12 : 20),
  )
  const focusedEntry = entries[selectionState.cursor]
  const selectedSummary = summarizeEvalEstimates(
    selectedEntries(entries, selectionState).map((entry) => entry.estimate),
  )
  const listContentWidth = Math.max(32, listPanelWidth - 4)
  const detailsContentWidth = Math.max(30, detailsPanelWidth - 4)

  useEffect(() => {
    if (!isRawModeSupported) {
      exit(
        new Error(
          "Interactive selection requires a terminal with raw mode support.",
        ),
      )
    }
  }, [exit, isRawModeSupported])

  useInput((input, key) => {
    const normalizedInput = input.toLowerCase()

    if (normalizedInput === "q" || key.escape) {
      exit({ kind: "cancel" })
      return
    }

    if (normalizedInput === "a") {
      setStatusMessage(null)
      setSelectionState((currentState) => toggleAllSelections(currentState))
      return
    }

    if (key.home) {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        setCursor(currentState, entries.length, 0),
      )
      return
    }

    if (key.end) {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        setCursor(currentState, entries.length, entries.length - 1),
      )
      return
    }

    if (key.upArrow || normalizedInput === "k") {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        moveCursor(currentState, entries.length, -1),
      )
      return
    }

    if (key.downArrow || normalizedInput === "j") {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        moveCursor(currentState, entries.length, 1),
      )
      return
    }

    if (key.pageUp) {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        moveCursor(
          currentState,
          entries.length,
          -(visibleWindow.end - visibleWindow.start),
        ),
      )
      return
    }

    if (key.pageDown) {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        moveCursor(
          currentState,
          entries.length,
          visibleWindow.end - visibleWindow.start,
        ),
      )
      return
    }

    if (input === " ") {
      setStatusMessage(null)
      setSelectionState((currentState) =>
        toggleHighlightedSelection(currentState),
      )
      return
    }

    if (key.return) {
      const selectedEvalFiles = getSelectedEvalFiles(
        entries.map((entry) => entry.file),
        selectionState,
      )

      if (selectedEvalFiles.length === 0) {
        setStatusMessage("Select at least one eval file to run.")
        return
      }

      exit({ kind: "run", evalFiles: selectedEvalFiles })
    }
  })

  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Text, { bold: true }, "Select eval files to run"),
    createElement(
      Text,
      { color: selectedSummary.selectedCount > 0 ? "green" : "yellow" },
      selectedSummaryText(selectedSummary),
    ),
    createElement(
      Text,
      { dimColor: true },
      "Wall shows an estimate range from saved baselines. Files run sequentially; the low end assumes in-file concurrency.",
    ),
    createElement(Newline),
    createElement(
      Box,
      {
        flexDirection: isWideLayout ? "row" : "column",
      },
      createElement(
        Box,
        {
          borderStyle: "round",
          borderColor: "cyan",
          paddingX: 1,
          paddingY: 0,
          width: listPanelWidth,
          flexDirection: "column",
        },
        createElement(Text, { bold: true }, "Eval Files"),
        createElement(Text, { dimColor: true }, listHeader(listContentWidth)),
        ...entries
          .slice(visibleWindow.start, visibleWindow.end)
          .map((entry, visibleIndex) => {
            const actualIndex = visibleWindow.start + visibleIndex
            const isFocused = actualIndex === selectionState.cursor
            const isSelected = selectionState.selected[actualIndex] ?? false

            return createElement(
              Text,
              {
                key: entry.file,
                color: isFocused ? "cyan" : undefined,
              },
              listRow(entry, isFocused, isSelected, listContentWidth),
            )
          }),
        entries.length > visibleWindow.end || visibleWindow.start > 0
          ? createElement(
              Text,
              { dimColor: true },
              `Showing ${visibleWindow.start + 1}-${visibleWindow.end} of ${entries.length}`,
            )
          : null,
      ),
      isWideLayout ? createElement(Text, null, " ") : null,
      focusedEntry
        ? createElement(
            Box,
            {
              borderStyle: "round",
              borderColor: focusedEntry.estimate.hasBaseline ? "green" : "yellow",
              paddingX: 1,
              paddingY: 0,
              width: detailsPanelWidth,
              flexDirection: "column",
            },
            ...detailsPanel(focusedEntry, detailsContentWidth),
          )
        : null,
    ),
    createElement(Newline),
    statusMessage
      ? createElement(Text, { color: "yellow" }, statusMessage)
      : createElement(
          Text,
          { dimColor: true },
          "space toggle  enter run  a all/none  arrows or j/k move  q cancel",
        ),
  )
}

export function createSelectionState(itemCount: number): SelectionState {
  return {
    cursor: 0,
    selected: Array(normalizeItemCount(itemCount)).fill(false),
  }
}

export function moveCursor(
  state: SelectionState,
  itemCount: number,
  delta: number,
): SelectionState {
  const count = normalizeItemCount(itemCount)
  if (count === 0 || delta === 0) {
    return state
  }

  const remainder = (state.cursor + delta) % count
  return {
    ...state,
    cursor: remainder >= 0 ? remainder : remainder + count,
  }
}

export function setCursor(
  state: SelectionState,
  itemCount: number,
  nextCursor: number,
): SelectionState {
  const count = normalizeItemCount(itemCount)
  if (count === 0) {
    return state
  }

  return {
    ...state,
    cursor: Math.max(0, Math.min(count - 1, nextCursor)),
  }
}

export function toggleSelection(
  state: SelectionState,
  index: number,
): SelectionState {
  if (index < 0 || index >= state.selected.length) {
    return state
  }

  const selected = [...state.selected]
  selected[index] = !selected[index]

  return {
    ...state,
    selected,
  }
}

export function toggleHighlightedSelection(
  state: SelectionState,
): SelectionState {
  return toggleSelection(state, state.cursor)
}

export function toggleAllSelections(state: SelectionState): SelectionState {
  if (state.selected.length === 0) {
    return state
  }

  const shouldSelectAll = state.selected.some((isSelected) => !isSelected)

  return {
    ...state,
    selected: state.selected.map(() => shouldSelectAll),
  }
}

export function getSelectedEvalFiles(
  evalFiles: string[],
  state: SelectionState,
): string[] {
  return evalFiles.filter((_, index) => state.selected[index])
}

export function getVisibleWindow(
  cursor: number,
  itemCount: number,
  pageSize: number,
): VisibleWindow {
  const count = normalizeItemCount(itemCount)
  const size = Math.max(1, Math.floor(pageSize))

  if (count <= size) {
    return { start: 0, end: count }
  }

  const halfWindow = Math.floor(size / 2)
  const maxStart = count - size
  const start = Math.max(0, Math.min(cursor - halfWindow, maxStart))

  return {
    start,
    end: start + size,
  }
}

export async function selectEvalFilesInteractive(
  options: SelectEvalFilesInteractiveOptions,
): Promise<SelectionResult> {
  const {
    cwd,
    evalFiles,
    estimates = [],
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive selection requires a TTY.")
  }

  const estimateByFile = new Map(
    estimates.map((estimate) => [estimate.evalFile, estimate]),
  )
  const entries = evalFiles.map((file) => ({
    file,
    label: relative(cwd, file),
    estimate:
      estimateByFile.get(file) ?? {
        evalFile: file,
        baselinePath: "",
        baselineUpdatedAt: null,
        hasBaseline: false,
        hasDetailedSuites: false,
        suites: [],
        workMs: null,
        wallLowerBoundMs: null,
        wallUpperBoundMs: null,
        testCount: null,
        tokens: {
          input: null,
          output: null,
          total: null,
        },
      },
  }))
  const app = createElement(SelectorApp, { entries })
  const instance = render(app, {
    stdin,
    stdout,
    stderr,
  })

  try {
    return (await instance.waitUntilExit()) as SelectionResult
  } finally {
    instance.cleanup()
  }
}
