<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'soft' | 'ghost' | 'danger' | 'dark'
    size?: 'md' | 'sm'
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', size: 'md', disabled: false, type: 'button' },
)
</script>

<template>
  <button class="uibtn" :class="[`v-${variant}`, `s-${size}`]" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.uibtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.uibtn:disabled { opacity: 0.55; cursor: default; }

.s-md { padding: 8px 16px; font-size: 13px; }
.s-sm { padding: 5px 10px; font-size: 12px; }

.v-primary { background: var(--accent); color: #fff; }
.v-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, black); }

.v-soft { background: var(--accent-soft); color: var(--accent); }
.v-soft:hover:not(:disabled) { background: var(--accent); color: #fff; }

.v-ghost { background: var(--card); color: var(--ink); border-color: var(--line); }
.v-ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

.v-danger { background: var(--danger-soft); color: var(--danger); }
.v-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }

.v-dark { background: var(--nav-card); color: var(--nav-ink); border-color: var(--nav-line); }
.v-dark:hover:not(:disabled) { border-color: var(--accent); color: #fff; }
</style>
