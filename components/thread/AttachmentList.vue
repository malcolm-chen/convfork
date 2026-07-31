<script setup lang="ts">
import type { Attachment } from '~/composables/useConversation'

defineProps<{ attachments: Attachment[] }>()

function fileUrl(a: Attachment) {
  return `/api/attachments/${a.id}`
}
function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
</script>

<template>
  <div v-if="attachments.length" class="attlist">
    <a
      v-for="a in attachments"
      :key="a.id"
      :href="fileUrl(a)"
      target="_blank"
      rel="noopener"
      class="attitem"
      :class="{ image: a.kind === 'image' }"
    >
      <img v-if="a.kind === 'image'" :src="fileUrl(a)" class="attimg" :alt="a.filename" />
      <span v-else class="attpdf">
        <AppIcon name="file" :size="13" />
        <span class="attpdfname">{{ a.filename }}</span>
        <span class="attpdfsize">{{ formatSize(a.size_bytes) }}</span>
      </span>
    </a>
  </div>
</template>

<style scoped>
.attlist { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.attitem { display: inline-flex; }
.attimg {
  max-width: 220px;
  max-height: 220px;
  border-radius: 10px;
  object-fit: cover;
  display: block;
}
/* Used inline in a user chat bubble (solid accent background), so the chip
   is a translucent overlay rather than the page's card color. */
.attpdf {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 12px;
  max-width: 220px;
}
.attpdfname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attpdfsize { flex: none; color: rgba(255, 255, 255, 0.8); }
</style>
