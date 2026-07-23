<script setup lang="ts">
// Inline SVG icons so we get crisp, consistent icons without a runtime
// font/CSS dependency. code-branch = Font Awesome Free 6 Solid (CC BY 4.0);
// add-reaction = Google Material Icons Outlined (Apache 2.0).
const props = withDefaults(defineProps<{ name: keyof typeof ICONS; size?: number }>(), {
  size: 16,
})

const ICONS = {
  'code-branch': {
    vb: '0 0 448 512',
    d: 'M80 104a24 24 0 1 0 0-48 24 24 0 1 0 0 48zm80-24c0 32.8-19.7 61-48 73.3l0 87.8c18.8-10.9 40.7-17.1 64-17.1l96 0c35.3 0 64-28.7 64-64l0-6.7C307.7 141 288 112.8 288 80c0-44.2 35.8-80 80-80s80 35.8 80 80c0 32.8-19.7 61-48 73.3l0 6.7c0 70.7-57.3 128-128 128l-96 0c-35.3 0-64 28.7-64 64l0 6.7c28.3 12.3 48 40.5 48 73.3c0 44.2-35.8 80-80 80s-80-35.8-80-80c0-32.8 19.7-61 48-73.3l0-6.7 0-198.7C19.7 141 0 112.8 0 80C0 35.8 35.8 0 80 0s80 35.8 80 80zm232 0a24 24 0 1 0 -48 0 24 24 0 1 0 48 0zM80 456a24 24 0 1 0 0-48 24 24 0 1 0 0 48z',
  },
  'add-reaction': {
    vb: '0 0 24 24',
    d: 'M7 9.5C7 8.67 7.67 8 8.5 8s1.5.67 1.5 1.5S9.33 11 8.5 11 7 10.33 7 9.5zm5 8c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5zm3.5-6.5c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zM22 1h-2v2h-2v2h2v2h2V5h2V3h-2V1zm-2 11c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.46 0 2.82.4 4 1.08V2.84A9.929 9.929 0 0 0 11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12c0-1.05-.17-2.05-.47-3H19.4c.38.93.6 1.94.6 3z',
  },
} as const
</script>

<template>
  <svg
    class="appicon"
    :viewBox="ICONS[props.name].vb"
    :width="props.size"
    :height="props.size"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="ICONS[props.name].d" />
  </svg>
</template>

<style scoped>
.appicon { display: inline-block; vertical-align: -0.125em; flex: none; }
</style>
