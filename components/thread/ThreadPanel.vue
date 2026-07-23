<script setup lang="ts">
import type { TreeNode } from '~/composables/useConversation'
import { renderMarkdown } from '~/utils/markdown'

const props = defineProps<{
  messages: TreeNode[] // linear path from root → selected node
  forkPointId?: string | null // when set, messages up to here are prior history
  memberNames?: Record<string, string>
  currentUserId?: string
  streamingText: string
  isStreaming: boolean
  error: string | null
  drafting?: boolean
  showVisibility?: boolean
}>()

// When forked, split the lineage: everything up to and including the fork
// point is inherited history; what follows (if anything yet) is the new branch.
const forkIdx = computed(() =>
  props.forkPointId ? props.messages.findIndex((m) => m.id === props.forkPointId) : -1,
)
const prior = computed(() => (forkIdx.value >= 0 ? props.messages.slice(0, forkIdx.value + 1) : []))
const fresh = computed(() => (forkIdx.value >= 0 ? props.messages.slice(forkIdx.value + 1) : props.messages))

function authorName(m: TreeNode) {
  if (m.role === 'assistant') return 'Agent'
  return props.memberNames?.[m.author_id] ?? 'Unknown'
}

function turnMeta(m: TreeNode) {
  if (props.showVisibility === false) return authorName(m)
  return `${authorName(m)} · ${m.visibility}`
}

function initials(m: TreeNode) {
  if (m.role === 'assistant') return 'AI'
  return avatarInitials(authorName(m))
}

function userAvatarStyle(m: TreeNode) {
  return avatarColors(m.author_id)
}

// Keep the newest message in view as the thread grows or tokens stream in.
const scroller = ref<HTMLElement | null>(null)
watch(
  () => [props.messages.length, props.streamingText],
  () => nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight })),
)
</script>

<template>
  <div ref="scroller" class="thread">
    <template v-for="m in prior" :key="m.id">
      <!-- Assistant: ChatGPT-style full-width, no bubble, markdown-rendered -->
      <div v-if="m.role === 'assistant'" class="turn assistant prior">
        <span class="mavatar assistant">AI</span>
        <div class="turnbody">
          <div class="meta">{{ turnMeta(m) }}</div>
          <ClientOnly>
            <div class="body md" v-html="renderMarkdown(m.content)" />
            <template #fallback><div class="body">{{ m.content }}</div></template>
          </ClientOnly>
        </div>
      </div>
      <!-- User: right-aligned bubble -->
      <div v-else class="msg user prior">
        <span class="mavatar user" :style="userAvatarStyle(m)">{{ initials(m) }}</span>
        <div class="bubble">
          <div class="meta">{{ turnMeta(m) }}</div>
          <div class="body">{{ m.content }}</div>
        </div>
      </div>
    </template>

    <div v-if="forkIdx >= 0" class="forkdivider">
      <span>This is a forked conversation. Continue chatting with the agent below.</span>
    </div>

    <template v-for="m in fresh" :key="m.id">
      <div v-if="m.role === 'assistant'" class="turn assistant">
        <span class="mavatar assistant">AI</span>
        <div class="turnbody">
          <div class="meta">{{ turnMeta(m) }}</div>
          <ClientOnly>
            <div class="body md" v-html="renderMarkdown(m.content)" />
            <template #fallback><div class="body">{{ m.content }}</div></template>
          </ClientOnly>
        </div>
      </div>
      <div v-else class="msg user">
        <span class="mavatar user" :style="userAvatarStyle(m)">{{ initials(m) }}</span>
        <div class="bubble">
          <div class="meta">{{ turnMeta(m) }}</div>
          <div class="body">{{ m.content }}</div>
        </div>
      </div>
    </template>

    <div v-if="isStreaming" class="turn assistant streaming">
      <span class="mavatar assistant">AI</span>
      <div class="turnbody">
        <div class="meta">Agent · streaming…</div>
        <ClientOnly>
          <div class="body md" v-html="renderMarkdown(streamingText)" />
          <template #fallback><div class="body">{{ streamingText }}</div></template>
        </ClientOnly>
        <span class="caret">▋</span>
      </div>
    </div>

    <p v-if="error" class="err">⚠️ {{ error }}</p>
    <p v-if="!messages.length && !streamingText" class="empty">
      <template v-if="drafting">
        Send a message to start this chat.
      </template>
      <template v-else>
        Select a chat from the list,<br />or press <strong>New chat</strong> to begin.
      </template>
    </p>
  </div>
</template>

<style scoped>
.thread {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── User bubble (unchanged look) ── */
.msg { display: flex; gap: 9px; max-width: 94%; }
.msg.user { align-self: flex-end; flex-direction: row-reverse; }
.msg.prior { opacity: 0.72; }

/* ── Assistant turn: full-width, no bubble (ChatGPT-style) ── */
.turn { display: flex; gap: 10px; align-self: stretch; max-width: 100%; }
.turn.prior { opacity: 0.72; }
.turnbody { min-width: 0; flex: 1; padding-top: 1px; }

.mavatar {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  font-size: 10.5px;
  font-weight: 600;
  margin-top: 2px;
}
.mavatar.user { /* per-user colors applied via :style */ }
.mavatar.assistant { background: var(--ink); color: var(--paper); }

.bubble { min-width: 0; padding: 9px 12px; border-radius: 12px; }
.msg.user .bubble { background: var(--accent); color: #fff; border-top-right-radius: 4px; }
.msg.prior.user .bubble { background: #6f86d8; }

.meta { font-size: 10px; opacity: 0.7; margin-bottom: 4px; }
.body { white-space: pre-wrap; font-size: 13.5px; line-height: 1.5; overflow-wrap: break-word; }
.caret { display: inline-block; margin-left: 1px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* ── Markdown typography (assistant only). v-html content isn't scoped, so
      it must be reached with :deep(). ── */
.body.md { white-space: normal; font-size: 13.5px; line-height: 1.62; }
.body.md :deep(> *:first-child) { margin-top: 0; }
.body.md :deep(> *:last-child) { margin-bottom: 0; }
.body.md :deep(p) { margin: 0 0 0.7em; }
.body.md :deep(h1),
.body.md :deep(h2),
.body.md :deep(h3),
.body.md :deep(h4) { margin: 1.1em 0 0.5em; line-height: 1.3; font-weight: 600; }
.body.md :deep(h1) { font-size: 1.35em; }
.body.md :deep(h2) { font-size: 1.22em; }
.body.md :deep(h3) { font-size: 1.1em; }
.body.md :deep(h4) { font-size: 1em; }
.body.md :deep(ul),
.body.md :deep(ol) { margin: 0 0 0.7em; padding-left: 1.4em; }
.body.md :deep(li) { margin: 0.2em 0; }
.body.md :deep(li > ul),
.body.md :deep(li > ol) { margin: 0.2em 0; }
.body.md :deep(a) { color: var(--accent); text-decoration: underline; }
.body.md :deep(strong) { font-weight: 600; }
.body.md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.12em 0.36em;
  border-radius: 5px;
}
.body.md :deep(pre) {
  margin: 0 0 0.7em;
  padding: 11px 13px;
  background: #1e1e24;
  color: #f1efe9;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.5;
}
.body.md :deep(pre code) { background: none; padding: 0; font-size: inherit; color: inherit; }
.body.md :deep(blockquote) {
  margin: 0 0 0.7em;
  padding: 0.1em 0 0.1em 0.9em;
  border-left: 3px solid var(--line);
  color: var(--muted);
}
.body.md :deep(table) { border-collapse: collapse; margin: 0 0 0.7em; font-size: 0.95em; display: block; overflow-x: auto; }
.body.md :deep(th),
.body.md :deep(td) { border: 1px solid var(--line); padding: 5px 9px; text-align: left; }
.body.md :deep(th) { background: rgba(0, 0, 0, 0.04); font-weight: 600; }
.body.md :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 1em 0; }
.body.md :deep(img) { max-width: 100%; border-radius: 8px; }
.body.md :deep(p:has(> .caret)) { display: inline; }

.forkdivider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.forkdivider::before,
.forkdivider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.forkdivider span { max-width: 260px; }

.err { color: #c0392b; font-size: 13px; }
.empty { color: var(--muted); text-align: center; margin-top: 48px; font-size: 13.5px; line-height: 1.6; }
</style>
