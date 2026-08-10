<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    busy?: boolean
  }>(),
  { confirmLabel: 'Confirm', cancelLabel: 'Cancel', busy: false },
)
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="dialog" role="alertdialog" aria-modal="true" :aria-label="title">
      <h3 class="dtitle" :class="{ withdesc: description }">{{ title }}</h3>
      <p v-if="description" class="ddesc">{{ description }}</p>
      <div class="dactions">
        <UiButton variant="ghost" class="cancelbtn" :disabled="busy" @click="emit('cancel')">{{ cancelLabel }}</UiButton>
        <UiButton variant="primary" class="confirmbtn" :disabled="busy" @click="emit('confirm')">
          {{ busy ? 'Working…' : confirmLabel }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 20, 30, 0.38);
  backdrop-filter: blur(1px);
  animation: fade-in 0.14s ease;
}
@keyframes fade-in { from { opacity: 0; } }

.dialog {
  width: 420px;
  max-width: calc(100vw - 48px);
  background: var(--card);
  border-radius: 22px;
  box-shadow: 0 24px 64px rgba(20, 20, 30, 0.28);
  padding: 32px 32px 28px;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.7, 0.3, 1);
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
}

.dtitle {
  margin: 0 0 28px;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ink);
}
.dtitle.withdesc { margin-bottom: 8px; }

.ddesc {
  margin: 0 0 28px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--muted);
}

.dactions { display: flex; justify-content: flex-end; gap: 12px; }
.cancelbtn, .confirmbtn { padding: 12px 22px; border-radius: 12px; font-size: 15px; font-weight: 600; }
.cancelbtn { background: var(--line); border-color: transparent; color: var(--ink); }
.cancelbtn:hover { background: var(--panel-edge); }
</style>
