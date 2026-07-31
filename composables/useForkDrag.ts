// Shared (module-scoped, singleton) drag state for the canvas's "thread"
// effect: press a turn's dot and drag across the canvas, a line follows the
// cursor. TreeNode.vue starts/updates/ends it; ReasoningTree.vue just renders
// the overlay — a plain reactive object is enough since there's only ever one
// drag happening at a time, regardless of how many cards exist.
const state = reactive({
  active: false,
  originX: 0,
  originY: 0,
  pointerX: 0,
  pointerY: 0,
})

export function useForkDrag() {
  function start(x: number, y: number) {
    state.active = true
    state.originX = x
    state.originY = y
    state.pointerX = x
    state.pointerY = y
  }
  function move(x: number, y: number) {
    state.pointerX = x
    state.pointerY = y
  }
  function end() {
    state.active = false
  }
  return { state, start, move, end }
}
