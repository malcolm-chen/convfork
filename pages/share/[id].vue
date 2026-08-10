<script setup lang="ts">
import type { Attachment, TreeNode } from '~/composables/useConversation'

// Public, unauthenticated view of a share link minted by
// pages/conversation/[id].vue's "Share" button (individual_llm condition
// only). No composer, no realtime, no auth — just the frozen thread,
// rendered with the same ThreadPanel component the live app uses so it
// reads identically to the original chat.
const route = useRoute()
const shareId = route.params.id as string

interface ShareResponse {
  conversationTitle: string
  nodes: TreeNode[]
  memberNames: Record<string, string>
  attachments: Attachment[]
}

const { data, error } = await useFetch<ShareResponse>(`/api/share/${shareId}`)

const attachmentsByNode = computed(() => {
  const map = new Map<string, Attachment[]>()
  for (const a of data.value?.attachments ?? []) {
    const arr = map.get(a.node_id) ?? []
    arr.push(a)
    map.set(a.node_id, arr)
  }
  return map
})
</script>

<template>
  <div class="sharepage">
    <header class="sharehdr">
      <h1>{{ data?.conversationTitle || 'Shared conversation' }}</h1>
      <span class="badge">Read-only</span>
    </header>
    <p v-if="error" class="notfound">This link is invalid or no longer available.</p>
    <ThreadPanel
      v-else
      class="sharethread"
      :messages="data?.nodes ?? []"
      :member-names="data?.memberNames ?? {}"
      :attachments-by-node="attachmentsByNode"
      :attachment-base-path="`/api/share/${shareId}/attachment/`"
      streaming-text=""
      :is-streaming="false"
      :error="null"
    />
  </div>
</template>

<style scoped>
.sharepage {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 760px;
  margin: 0 auto;
}
.sharehdr {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  height: 64px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.sharehdr h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}
.notfound { padding: 24px 20px; color: var(--muted); }
.sharethread { flex: 1; }
</style>
