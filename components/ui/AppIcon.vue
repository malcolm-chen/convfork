<script setup lang="ts">
// Inline SVG icons so we get crisp, consistent icons without a runtime
// font/CSS dependency. Filled icons (code-branch, thumbtack, add-reaction)
// are Font Awesome Free 6 Solid (CC BY 4.0) / Google Material Icons
// Outlined (Apache 2.0). Stroke icons are hand-drawn 24x24 Feather-style
// glyphs — no external license to track.
const props = withDefaults(defineProps<{ name: keyof typeof ICONS; size?: number }>(), {
  size: 16,
})

interface FillIcon { kind: 'fill'; vb: string; d: string }
interface StrokeIcon { kind: 'stroke'; vb: string; shapes: string }

const ICONS: Record<string, FillIcon | StrokeIcon> = {
  'code-branch': {
    kind: 'fill',
    vb: '0 0 448 512',
    d: 'M80 104a24 24 0 1 0 0-48 24 24 0 1 0 0 48zm80-24c0 32.8-19.7 61-48 73.3l0 87.8c18.8-10.9 40.7-17.1 64-17.1l96 0c35.3 0 64-28.7 64-64l0-6.7C307.7 141 288 112.8 288 80c0-44.2 35.8-80 80-80s80 35.8 80 80c0 32.8-19.7 61-48 73.3l0 6.7c0 70.7-57.3 128-128 128l-96 0c-35.3 0-64 28.7-64 64l0 6.7c28.3 12.3 48 40.5 48 73.3c0 44.2-35.8 80-80 80s-80-35.8-80-80c0-32.8 19.7-61 48-73.3l0-198.7C19.7 141 0 112.8 0 80C0 35.8 35.8 0 80 0s80 35.8 80 80zm232 0a24 24 0 1 0 -48 0 24 24 0 1 0 48 0zM80 456a24 24 0 1 0 0-48 24 24 0 1 0 0 48z',
  },
  'add-reaction': {
    kind: 'fill',
    vb: '0 0 24 24',
    d: 'M7 9.5C7 8.67 7.67 8 8.5 8s1.5.67 1.5 1.5S9.33 11 8.5 11 7 10.33 7 9.5zm5 8c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5zm3.5-6.5c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zM22 1h-2v2h-2v2h2v2h2V5h2V3h-2V1zm-2 11c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.46 0 2.82.4 4 1.08V2.84A9.929 9.929 0 0 0 11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12c0-1.05-.17-2.05-.47-3H19.4c.38.93.6 1.94.6 3z',
  },
  thumbtack: {
    kind: 'fill',
    vb: '0 0 384 512',
    d: 'M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29.5 0 11.4 148.2c36.7 19.9 65.7 53.2 79.5 94.7l1 3c3.3 9.8 1.6 20.5-4.4 28.8s-15.7 13.3-26 13.3L32 352c-10.3 0-19.9-4.9-26-13.3s-7.7-19.1-4.4-28.8l1-3c13.8-41.5 42.8-74.8 79.5-94.7L93.5 64 64 64C46.3 64 32 49.7 32 32zM160 384l64 0 0 96c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-96z',
  },
  search: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/>',
  },
  gear: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<circle cx="12" cy="12" r="4"/>' +
      '<line x1="18" y1="12" x2="21" y2="12"/><line x1="3" y1="12" x2="6" y2="12"/>' +
      '<line x1="16.24" y1="16.24" x2="18.36" y2="18.36"/><line x1="5.64" y1="5.64" x2="7.76" y2="7.76"/>' +
      '<line x1="12" y1="18" x2="12" y2="21"/><line x1="12" y1="3" x2="12" y2="6"/>' +
      '<line x1="16.24" y1="7.76" x2="18.36" y2="5.64"/><line x1="5.64" y1="18.36" x2="7.76" y2="16.24"/>',
  },
  target: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  },
  lock: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  },
  unlock: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.75-1.5"/>',
  },
  'chevron-down': {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<polyline points="6 9 12 15 18 9"/>',
  },
  'zoom-in': {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/>' +
      '<line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  },
  'zoom-out': {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/><line x1="8" y1="11" x2="14" y2="11"/>',
  },
  expand: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>' +
      '<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  },
  // Compose / square-pen — a rounded square with a pen (new chat).
  compose: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  },
  paperclip: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  },
  x: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  },
  file: {
    kind: 'stroke',
    vb: '0 0 24 24',
    shapes:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  },
}

const icon = computed(() => ICONS[props.name])
</script>

<template>
  <svg
    class="appicon"
    :viewBox="icon.vb"
    :width="props.size"
    :height="props.size"
    :fill="icon.kind === 'fill' ? 'currentColor' : 'none'"
    :stroke="icon.kind === 'stroke' ? 'currentColor' : 'none'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-if="icon.kind === 'fill'" :d="icon.d" />
    <g v-else v-html="icon.shapes" />
  </svg>
</template>

<style scoped>
.appicon { display: inline-block; vertical-align: -0.125em; flex: none; }
</style>
