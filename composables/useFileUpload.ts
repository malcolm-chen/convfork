import { v4 as uuidv4 } from 'uuid'

export interface AttachmentRef {
  key: string
  filename: string
  contentType: string
  size: number
  kind: 'image' | 'pdf'
}

export interface PendingAttachment {
  localId: string
  filename: string
  previewUrl: string | null // object URL for images; null for PDFs
  status: 'uploading' | 'done' | 'error'
  error?: string
  ref?: AttachmentRef
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PDF_BYTES = 25 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])

// Client-side counterpart to /api/upload: tracks attach → upload → ready
// state for files staged in the composer before a message is sent.
export function useFileUpload() {
  const pending = ref<PendingAttachment[]>([])
  const isUploading = computed(() => pending.value.some((p) => p.status === 'uploading'))

  async function addFiles(files: File[], conversationId: string) {
    const accepted = files.filter((f) => ALLOWED_TYPES.has(f.type))
    if (!accepted.length) return

    const staged = accepted.map((file) => ({
      file,
      item: reactive<PendingAttachment>({
        localId: uuidv4(),
        filename: file.name,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        status: 'uploading' as const,
      }),
    }))
    for (const s of staged) pending.value.push(s.item)

    const form = new FormData()
    form.set('conversationId', conversationId)
    for (const s of staged) {
      const maxBytes = s.file.type === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
      if (s.file.size > maxBytes) {
        s.item.status = 'error'
        s.item.error = `exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`
        continue
      }
      form.append('file', s.file, s.file.name)
    }

    const toUpload = staged.filter((s) => s.item.status === 'uploading')
    if (!toUpload.length) return

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`upload failed: ${res.status}`)
      const { attachments } = (await res.json()) as { attachments: AttachmentRef[] }
      toUpload.forEach((s, i) => {
        s.item.status = 'done'
        s.item.ref = attachments[i]
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'upload failed'
      for (const s of toUpload) {
        s.item.status = 'error'
        s.item.error = message
      }
    }
  }

  function remove(localId: string) {
    const item = pending.value.find((p) => p.localId === localId)
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    pending.value = pending.value.filter((p) => p.localId !== localId)
  }

  function clear() {
    for (const p of pending.value) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    pending.value = []
  }

  function readyRefs(): AttachmentRef[] {
    return pending.value.filter((p) => p.status === 'done' && p.ref).map((p) => p.ref!)
  }

  return { pending, isUploading, addFiles, remove, clear, readyRefs }
}
