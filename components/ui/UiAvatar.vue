<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    name: string
    colorKey?: string
    size?: number
    online?: boolean
  }>(),
  { size: 26, online: false },
)

const swatch = computed(() => avatarColors(props.colorKey ?? props.name))
const initials = computed(() => avatarInitials(props.name))
</script>

<template>
  <span
    class="uiavatar"
    :style="{
      width: size + 'px',
      height: size + 'px',
      fontSize: Math.round(size * 0.4) + 'px',
      background: swatch.background,
      color: swatch.color,
    }"
  >
    {{ initials }}
    <span v-if="online" class="dot" />
  </span>
</template>

<style scoped>
.uiavatar {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-weight: 600;
  line-height: 1;
}
.dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nav-online);
  border: 2px solid var(--nav-bg);
}
</style>
