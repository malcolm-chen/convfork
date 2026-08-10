<script setup lang="ts">
// Minimal fire-and-forget toast: fades in/out, dismisses itself. The caller
// only needs to set/clear `message` — see shareConversation() in
// pages/conversation/[id].vue for the fade-out timing.
defineProps<{ message: string | null }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="uitoast">
      <div v-if="message" class="uitoast" role="status">{{ message }}</div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.uitoast {
  position: fixed;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  z-index: 300;
  padding: 10px 20px;
  border-radius: 10px;
  background: rgba(23, 23, 26, 0.82);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  white-space: nowrap;
}
.uitoast-enter-active,
.uitoast-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.uitoast-enter-from,
.uitoast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
