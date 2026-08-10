<script setup lang="ts">
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, type ThinkingEffort } from '#shared/models'
import type { AttachmentRef } from '~/composables/useFileUpload'

const props = defineProps<{
  conversationId: string
  parentNodeId: string | null
  forked?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  (
    e: 'submit',
    payload: { text: string; model: string; thinking?: ThinkingEffort; attachments?: AttachmentRef[] },
  ): void
}>()

const { pending: pendingFiles, isUploading, addFiles, remove: removeFile, clear: clearFiles, readyRefs } = useFileUpload()
const fileInput = ref<HTMLInputElement | null>(null)

function pickFiles() {
  fileInput.value?.click()
}
function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(Array.from(input.files), props.conversationId)
  input.value = ''
}
function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const THINKING_LEVELS: { value: ThinkingEffort; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'medium', label: 'Medium thinking' },
  { value: 'high', label: 'High thinking' },
]

const text = ref('')
const logger = useActionLogger()

const runtimeConfig = useRuntimeConfig()
const availableModels = computed(() =>
  MODEL_OPTIONS.filter((m) =>
    m.provider === 'openai' ? runtimeConfig.public.hasOpenaiKey : runtimeConfig.public.hasAnthropicKey,
  ),
)
const model = ref(
  availableModels.value.some((m) => m.id === DEFAULT_MODEL_ID)
    ? DEFAULT_MODEL_ID
    : (availableModels.value[0]?.id ?? DEFAULT_MODEL_ID),
)
const modelSupportsThinking = computed(
  () => !!availableModels.value.find((m) => m.id === model.value)?.supportsThinking,
)
const thinking = ref<ThinkingEffort>('instant')
watch(model, () => {
  thinking.value = 'instant'
})

function onInput() {
  logger.logTyping(text.value.length, { conversationId: props.conversationId })
}

function submit() {
  const t = text.value.trim()
  const attachments = readyRefs()
  if ((!t && !attachments.length) || props.disabled || isUploading.value) return
  emit('submit', {
    text: t,
    model: model.value,
    thinking: modelSupportsThinking.value ? thinking.value : undefined,
    attachments: attachments.length ? attachments : undefined,
  })
  text.value = ''
  clearFiles()
}
</script>

<template>
  <div class="composer">
    <div class="box">
      <div v-if="pendingFiles.length" class="attachrow">
        <div
          v-for="f in pendingFiles"
          :key="f.localId"
          class="attachchip"
          :class="{ error: f.status === 'error', uploading: f.status === 'uploading' }"
        >
          <img v-if="f.previewUrl" :src="f.previewUrl" class="attachthumb" alt="" />
          <AppIcon v-else name="file" :size="14" class="attachfileicon" />
          <span class="attachname">{{ f.status === 'error' ? (f.error ?? 'failed') : f.filename }}</span>
          <button type="button" class="attachremove" title="Remove" @click="removeFile(f.localId)">
            <AppIcon name="x" :size="10" />
          </button>
        </div>
      </div>
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
        <div class="footright">
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            multiple
            hidden
            @change="onFilesPicked"
          />
          <button type="button" class="attachbtn" title="Attach files" :disabled="disabled" @click="pickFiles">
            <AppIcon name="paperclip" :size="15" />
          </button>
          <label v-if="modelSupportsThinking" class="modelwrap">
            <select v-model="thinking" class="modelselect" :disabled="disabled" title="Thinking effort">
              <option v-for="lvl in THINKING_LEVELS" :key="lvl.value" :value="lvl.value">{{ lvl.label }}</option>
            </select>
            <AppIcon name="chevron-down" :size="11" class="modelcaret" />
          </label>
          <label class="modelwrap">
            <select v-model="model" class="modelselect" :disabled="disabled" title="Model backbone">
              <option v-for="m in availableModels" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <AppIcon name="chevron-down" :size="11" class="modelcaret" />
          </label>
          <UiButton
            :disabled="disabled || isUploading || (!text.trim() && !pendingFiles.some((p) => p.status === 'done'))"
            @click="submit"
          >
            {{ disabled ? 'Generating…' : isUploading ? 'Uploading…' : 'Send' }}
          </UiButton>
        </div>
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
.foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; row-gap: 8px; margin-top: 6px; }
.ctx { margin: 0; font-size: 11px; color: var(--muted); }
.footright { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; min-width: 0; }
.modelwrap { position: relative; display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
.modelselect {
  appearance: none;
  min-width: 0;
  max-width: 100%;
  padding: 6px 26px 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modelselect:disabled { opacity: 0.55; cursor: default; }
.modelcaret { position: absolute; right: 9px; pointer-events: none; color: var(--muted); }

.attachbtn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  color: var(--muted);
  cursor: pointer;
}
.attachbtn:hover { color: var(--ink); }
.attachbtn:disabled { opacity: 0.55; cursor: default; }

.attachrow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.attachchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 4px 8px 4px 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--card);
  font-size: 11.5px;
  color: var(--ink);
}
.attachchip.uploading { opacity: 0.6; }
.attachchip.error { border-color: var(--danger); color: var(--danger); }
.attachthumb { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex: none; }
.attachfileicon { flex: none; color: var(--muted); }
.attachname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachremove {
  display: grid;
  place-items: center;
  flex: none;
  width: 14px;
  height: 14px;
  border: none;
  background: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}
.attachremove:hover { opacity: 1; }
</style>
