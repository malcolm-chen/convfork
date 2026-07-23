<script setup lang="ts">
const emit = defineEmits<{ (e: 'fork'): void }>()
</script>

<template>
  <button class="fork" title="Fork a new branch from this node" @click.stop="emit('fork')">
    <AppIcon name="code-branch" :size="12" />
    <span>Fork</span>
  </button>
</template>

<style scoped>
.fork {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  padding: 3px 11px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}
.fork:hover { background: var(--accent); color: #fff; }
</style>
