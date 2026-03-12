import { describe, expect, test } from "bun:test"
import {
  createSelectionState,
  getSelectedEvalFiles,
  getVisibleWindow,
  moveCursor,
  setCursor,
  toggleAllSelections,
  toggleHighlightedSelection,
} from "./selector"

describe("selection state helpers", () => {
  test("starts with the first item focused and nothing selected", () => {
    expect(createSelectionState(3)).toEqual({
      cursor: 0,
      selected: [false, false, false],
    })
  })

  test("wraps cursor movement across the list", () => {
    const initialState = createSelectionState(3)

    expect(moveCursor(initialState, 3, -1).cursor).toBe(2)
    expect(moveCursor(initialState, 3, 4).cursor).toBe(1)
  })

  test("clamps direct cursor jumps within bounds", () => {
    const initialState = createSelectionState(3)

    expect(setCursor(initialState, 3, -10).cursor).toBe(0)
    expect(setCursor(initialState, 3, 99).cursor).toBe(2)
  })

  test("toggles the focused item and returns selected files in order", () => {
    const stateAfterFirstToggle = toggleHighlightedSelection(createSelectionState(3))
    const stateWithThirdFocused = setCursor(stateAfterFirstToggle, 3, 2)
    const finalState = toggleHighlightedSelection(stateWithThirdFocused)

    expect(getSelectedEvalFiles(["a", "b", "c"], finalState)).toEqual(["a", "c"])
  })

  test("toggles all items on and back off", () => {
    const allSelected = toggleAllSelections(createSelectionState(2))
    const noneSelected = toggleAllSelections(allSelected)

    expect(allSelected.selected).toEqual([true, true])
    expect(noneSelected.selected).toEqual([false, false])
  })
})

describe("visible window helpers", () => {
  test("centers the focused item when possible", () => {
    expect(getVisibleWindow(5, 20, 7)).toEqual({
      start: 2,
      end: 9,
    })
  })

  test("sticks to the edges near the start and end", () => {
    expect(getVisibleWindow(1, 20, 7)).toEqual({
      start: 0,
      end: 7,
    })
    expect(getVisibleWindow(19, 20, 7)).toEqual({
      start: 13,
      end: 20,
    })
  })
})
