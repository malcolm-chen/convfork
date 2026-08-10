// Shared (module-scoped, singleton) selection state for the dashboard's
// merge-mode selection bar — same minimal shape as useForkDrag.ts: a plain
// reactive object plus start/stop functions, since there's only ever one
// merge-mode session active at a time.
const state = reactive({
  active: false,
  selectedIds: new Set<string>(),
})

export function useMergeMode() {
  function enter() {
    state.active = true
    state.selectedIds = new Set()
  }
  function cancel() {
    state.active = false
    state.selectedIds = new Set()
  }
  function toggle(id: string) {
    const next = new Set(state.selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    state.selectedIds = next
  }
  return { state, enter, cancel, toggle }
}
