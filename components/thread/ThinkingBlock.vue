<script setup lang="ts">
// ChatGPT/Claude-style collapsible reasoning trace: expanded live while the
// model is still thinking (and no answer text has arrived yet), then folds
// itself once the answer starts — but the user's own toggle always wins.
const props = defineProps<{
  reasoning: string
  autoExpand?: boolean
}>()

const manualOverride = ref<boolean | null>(null)
const expanded = computed(() => manualOverride.value ?? !!props.autoExpand)

function toggle() {
  manualOverride.value = !expanded.value
}
</script>

<template>
  <div v-if="reasoning" class="thinkblock">
    <button type="button" class="thinktoggle" @click="toggle">
      <AppIcon name="chevron-down" :size="10" class="caret" :class="{ collapsed: !expanded }" />
      {{ autoExpand ? 'Thinking…' : 'Thoughts' }}
    </button>
    <div v-if="expanded" class="thinktext">{{ reasoning }}</div>
  </div>
</template>

<style scoped>
.thinkblock { margin-bottom: 6px; }
.thinktoggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11.5px;
  font-style: italic;
  cursor: pointer;
}
.thinktoggle:hover { color: var(--ink); }
.caret { transition: transform 0.15s ease; }
.caret.collapsed { transform: rotate(-90deg); }
.thinktext {
  margin-top: 4px;
  padding: 8px 10px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
</style>
