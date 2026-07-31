<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'

const { zoomIn, zoomOut, fitView, viewport } = useVueFlow()
// A fitView() computed off an unmeasured (zero-size) pane or node set can
// leave viewport.zoom as NaN/Infinity (see ReasoningTree.vue) — never surface
// that to the user as "NaN%"; fall back to 100% until a real zoom lands.
const pct = computed(() => {
  const z = Math.round(viewport.zoom * 100)
  return Number.isFinite(z) ? z : 100
})
</script>

<template>
  <div class="canvascontrols">
    <UiIconButton title="Zoom out" @click="zoomOut()">
      <AppIcon name="zoom-out" :size="14" />
    </UiIconButton>
    <span class="pct">{{ pct }}%</span>
    <UiIconButton title="Zoom in" @click="zoomIn()">
      <AppIcon name="zoom-in" :size="14" />
    </UiIconButton>
    <UiIconButton title="Fit to view" @click="fitView()">
      <AppIcon name="expand" :size="14" />
    </UiIconButton>
  </div>
</template>

<style scoped>
.canvascontrols {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 999px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 6px 20px rgba(15, 15, 20, 0.12);
}
.pct {
  min-width: 34px;
  text-align: center;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
