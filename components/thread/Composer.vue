<script setup lang="ts">
const props = defineProps<{
  conversationId: string
  parentNodeId: string | null
  forked?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'submit', text: string): void }>()

const text = ref('')
const logger = useActionLogger()

function onInput() {
  logger.logTyping(text.value.length, { conversationId: props.conversationId })
}

function submit() {
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('submit', t)
  text.value = ''
}
</script>

<template>
  <div class="composer">
    <div class="box">
      <textarea
        v-model="text"
        :disabled="disabled"
        placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
        @input="onInput"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="foot">
        <p class="ctx">
          <template v-if="forked">⑂ forking from selected node</template>
          <template v-else-if="parentNodeId">↳ continuing this chat</template>
          <template v-else>starting a new chat</template>
        </p>
        <button :disabled="disabled || !text.trim()" @click="submit">
          {{ disabled ? 'Generating…' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer { padding: 12px 16px 16px; border-top: 1px solid var(--line); }
.box {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  padding: 10px;
  transition: border-color 0.15s ease;
}
.box:focus-within { border-color: var(--accent); }
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 56px;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink);
  outline: none;
}
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.ctx { margin: 0; font-size: 11px; color: var(--muted); }
button {
  padding: 7px 18px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
button:disabled { opacity: 0.55; cursor: default; }
</style>
