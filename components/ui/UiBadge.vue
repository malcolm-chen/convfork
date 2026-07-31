<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'accent' | 'neutral' | 'warning' }>(), { variant: 'accent' })
</script>

<template>
  <span class="uibadge" :class="`v-${variant}`"><slot /></span>
</template>

<style scoped>
.uibadge {
  display: inline-flex;
  align-items: center;
  flex: none;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.5;
  white-space: nowrap;
}
.v-accent { background: var(--accent-soft); color: var(--accent); }
.v-neutral { background: var(--line); color: var(--muted); }
.v-warning { background: #f2e9dd; color: #8a6d3b; }
</style>
