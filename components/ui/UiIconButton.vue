<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number
    variant?: 'ghost' | 'soft' | 'dark'
    title?: string
    disabled?: boolean
  }>(),
  { size: 30, variant: 'ghost', disabled: false },
)
</script>

<template>
  <button
    type="button"
    class="uiiconbtn"
    :class="`v-${variant}`"
    :style="{ width: size + 'px', height: size + 'px' }"
    :title="title"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.uiiconbtn {
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.uiiconbtn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.uiiconbtn:disabled { opacity: 0.5; cursor: default; }

.v-soft { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
.v-soft:hover:not(:disabled) { background: var(--accent); color: #fff; }

.v-dark { background: var(--nav-card); border-color: var(--nav-line); color: var(--nav-muted); }
.v-dark:hover:not(:disabled) { border-color: var(--accent); color: #fff; }
</style>
