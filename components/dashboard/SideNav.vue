<script setup lang="ts">
// Shared left rail: brand, team members, projects, settings.
// Presentational — the host page fetches data and handles create/signout.
interface Member { id: string; display_name: string; role: string | null }
interface ConvoItem { id: string; title: string | null }

const props = defineProps<{
  displayName: string
  isResearcher: boolean
  teamName: string
  members: Member[]
  conversations: ConvoItem[]
  activeId?: string | null
  userId?: string
  // Who's currently online, team-wide (see useTeamPresence.ts) — falls back
  // to "just me" if presence hasn't synced yet (e.g. the instant after mount).
  onlineIds?: Set<string>
  // Solo-chat study condition: there's no team to share a named project
  // with, so creation skips the naming step entirely (see openCreate below).
  individualLlm?: boolean
}>()
const emit = defineEmits<{
  (e: 'create', title: string): void
  (e: 'rename', id: string, title: string): void
  (e: 'delete', id: string): void
  (e: 'signout'): void
}>()

const memberQuery = ref('')
const filteredMembers = computed(() => {
  const q = memberQuery.value.trim().toLowerCase()
  if (!q) return props.members
  return props.members.filter((m) => m.display_name.toLowerCase().includes(q))
})

const creating = ref(false)
const newTitle = ref('')
const newTitleInput = ref<HTMLInputElement | null>(null)

// Inline rename of the active project (only one row at a time).
const renamingId = ref<string | null>(null)
const renameTitle = ref('')
let renameEl: HTMLInputElement | null = null

function setRenameEl(el: unknown) {
  renameEl = el as HTMLInputElement | null
}

function startRename(c: ConvoItem) {
  renamingId.value = c.id
  renameTitle.value = c.title || 'Untitled'
  nextTick(() => {
    renameEl?.focus()
    renameEl?.select()
  })
}
function submitRename() {
  const id = renamingId.value
  const title = renameTitle.value.trim()
  renamingId.value = null
  if (id && title) emit('rename', id, title)
}

function openCreate() {
  if (props.individualLlm) {
    emit('create', '')
    return
  }
  creating.value = true
  nextTick(() => newTitleInput.value?.focus())
}
function toggleCreate() {
  if (props.individualLlm) {
    openCreate()
    return
  }
  creating.value ? (creating.value = false) : openCreate()
}
function submit() {
  emit('create', newTitle.value)
  newTitle.value = ''
  creating.value = false
}
defineExpose({ openCreate })
</script>

<template>
  <aside class="nav">
    <div class="navsection">
      <p class="navlabel">TEAM</p>
      <label class="search">
        <AppIcon name="search" :size="13" />
        <input v-model="memberQuery" type="text" placeholder="Search team…" />
      </label>
      <ul class="memberlist">
        <li v-for="m in filteredMembers" :key="m.id">
          <UiAvatar :name="m.display_name" :color-key="m.id" :size="26" :online="onlineIds ? onlineIds.has(m.id) : m.id === userId" />
          <span class="mname">
            {{ m.display_name }}<span v-if="m.id === userId" class="you"> (you)</span>
          </span>
          <span v-if="m.role" class="mrole">{{ m.role }}</span>
        </li>
        <li v-if="!filteredMembers.length" class="navempty">No members match “{{ memberQuery }}”</li>
      </ul>
    </div>

    <div class="navsection grow">
      <div class="navhead">
        <p class="navlabel">Projects</p>
        <UiIconButton variant="dark" :size="24" class="plus" title="New conversation tree" @click="toggleCreate">+</UiIconButton>
      </div>
      <form v-if="creating" class="newproj" @submit.prevent="submit">
        <input
          ref="newTitleInput"
          v-model="newTitle"
          placeholder="New conversation title…"
          @keyup.esc="creating = false"
        />
      </form>
      <ul class="projlist">
        <li v-for="c in conversations" :key="c.id">
          <form v-if="renamingId === c.id" class="renameform" @submit.prevent="submitRename">
            <input
              :ref="setRenameEl"
              v-model="renameTitle"
              @keyup.esc="renamingId = null"
              @blur="renamingId = null"
            />
          </form>
          <template v-else>
            <NuxtLink :to="`/conversation/${c.id}`" :class="{ active: c.id === activeId }">
              <span class="ptitle">{{ c.title || 'Untitled' }}</span>
            </NuxtLink>
            <template v-if="c.id === activeId">
              <UiIconButton variant="dark" :size="22" class="pact" title="Rename project" @click="startRename(c)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </UiIconButton>
              <UiIconButton variant="dark" :size="22" class="pact danger" title="Delete project" @click="emit('delete', c.id)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </UiIconButton>
            </template>
          </template>
        </li>
        <li v-if="!conversations.length" class="navempty">No projects yet — press +</li>
      </ul>
    </div>

    <div class="navsection settings">
      <div class="me">
        <UiAvatar :name="displayName || '?'" :color-key="userId || displayName" :size="26" />
        <span class="mname">{{ displayName }}</span>
      </div>
      <UiButton variant="dark" class="settingsbtn" @click="emit('signout')">Sign out</UiButton>
    </div>
  </aside>
</template>

<style scoped>
.nav {
  display: flex;
  flex-direction: column;
  gap: 22px;
  box-sizing: border-box;
  padding: 26px 20px;
  background: var(--nav-bg);
  color: var(--nav-ink);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.navlabel {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--nav-muted);
}
.navsection.grow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.navhead { display: flex; align-items: center; justify-content: space-between; }
.navhead .navlabel { margin-bottom: 0; }

.search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 8px;
  padding: 7px 10px;
  border: 1px solid var(--nav-line);
  border-radius: 8px;
  background: var(--nav-card);
  color: var(--nav-muted);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--nav-ink);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.search input::placeholder { color: var(--nav-muted); }

.memberlist, .projlist { list-style: none; margin: 10px 0 0; padding: 0; }
.navsection.grow .projlist { flex: 1; min-height: 0; overflow-y: auto; }
.memberlist li {
  display: flex; align-items: center; gap: 9px;
  padding: 6px 4px;
  font-size: 13.5px;
  border-radius: 8px;
  transition: background 0.12s ease;
}
.memberlist li:hover { background: var(--nav-card); }
.mname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.you { color: var(--nav-muted); }
.mrole { margin-left: auto; font-size: 11px; color: var(--nav-muted); }

.newproj { margin: 10px 0 4px; }
.newproj input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: var(--nav-card);
  color: var(--nav-ink);
}
.projlist li { display: flex; align-items: center; gap: 4px; }
.projlist li a {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border-radius: 8px;
  color: var(--nav-ink);
  text-decoration: none;
  font-size: 13.5px;
  transition: background 0.15s ease;
}
.ptitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.projlist li a:hover { background: var(--nav-card); color: #fff; }
.projlist li a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.navempty { padding: 6px 4px; font-size: 12.5px; color: var(--nav-muted); }

.pact.danger:hover { border-color: var(--danger); color: var(--danger); }

.renameform { flex: 1; min-width: 0; }
.renameform input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: var(--nav-card);
  color: var(--nav-ink);
}

.settings { border-top: 1px solid var(--nav-line); padding-top: 16px; }
.me { display: flex; align-items: center; gap: 9px; font-size: 13.5px; margin-bottom: 10px; }
.settingsbtn { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; text-align: left; }
</style>
