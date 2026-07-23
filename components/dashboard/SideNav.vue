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
}>()
const emit = defineEmits<{
  (e: 'create', title: string): void
  (e: 'rename', id: string, title: string): void
  (e: 'delete', id: string): void
  (e: 'signout'): void
}>()

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
  creating.value = true
  nextTick(() => newTitleInput.value?.focus())
}
function toggleCreate() {
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
    <NuxtLink to="/" class="brandlink"><p class="brand">Conv<em>Fork</em></p></NuxtLink>

    <div class="navsection">
      <p class="navlabel">Team · {{ teamName }}</p>
      <ul class="memberlist">
        <li v-for="m in members" :key="m.id">
          <span class="avatar" :style="avatarColors(m.id)">{{ avatarInitials(m.display_name) }}</span>
          <span class="mname">
            {{ m.display_name }}<span v-if="m.id === userId" class="you"> · you</span>
          </span>
          <span v-if="m.role" class="mrole">{{ m.role }}</span>
        </li>
      </ul>
    </div>

    <div class="navsection grow">
      <div class="navhead">
        <p class="navlabel">Projects</p>
        <button class="plus" title="New conversation tree" @click="toggleCreate">+</button>
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
              {{ c.title || 'Untitled' }}
            </NuxtLink>
            <template v-if="c.id === activeId">
              <button class="pact" title="Rename project" @click="startRename(c)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </button>
              <button class="pact danger" title="Delete project" @click="emit('delete', c.id)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </template>
          </template>
        </li>
        <li v-if="!conversations.length" class="navempty">No projects yet — press +</li>
      </ul>
    </div>

    <div class="navsection settings">
      <div class="me">
        <span class="avatar" :style="avatarColors(userId || displayName)">{{ avatarInitials(displayName || '?') }}</span>
        <span class="mname">{{ displayName }}</span>
      </div>
      <button class="settingsbtn" @click="emit('signout')">Sign out</button>
    </div>
  </aside>
</template>

<style scoped>
.nav {
  display: flex;
  flex-direction: column;
  gap: 26px;
  box-sizing: border-box;
  padding: 26px 20px;
  border-right: 2px solid var(--panel-edge);
  background: var(--paper);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.brandlink { text-decoration: none; color: inherit; }
.brand {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 21px;
  letter-spacing: -0.01em;
}
.brand em { font-style: italic; color: var(--accent); }

.navlabel {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
.navsection.grow { flex: 1; min-height: 0; }
.navhead { display: flex; align-items: center; justify-content: space-between; }
.navhead .navlabel { margin-bottom: 0; }
.plus {
  width: 24px; height: 24px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--card);
  color: var(--ink);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}
.plus:hover { background: var(--accent); border-color: var(--accent); color: #fff; }

.memberlist, .projlist { list-style: none; margin: 10px 0 0; padding: 0; }
.memberlist li {
  display: flex; align-items: center; gap: 9px;
  padding: 6px 4px;
  font-size: 13.5px;
}
.avatar {
  flex: none;
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border-radius: 50%;
  font-size: 10.5px; font-weight: 600;
}
.mname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.you { color: var(--muted); }
.mrole { margin-left: auto; font-size: 11px; color: var(--muted); }

.newproj { margin: 10px 0 4px; }
.newproj input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: var(--card);
}
.projlist li { display: flex; align-items: center; gap: 4px; }
.projlist li a {
  display: block;
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border-radius: 8px;
  color: var(--ink);
  text-decoration: none;
  font-size: 13.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.15s ease;
}
.projlist li a:hover { background: var(--accent-soft); color: var(--accent); }
.projlist li a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.navempty { padding: 6px 4px; font-size: 12.5px; color: var(--muted); }

.pact {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.pact:hover { border-color: var(--accent); color: var(--accent); }
.pact.danger:hover { border-color: #a2453c; color: #a2453c; background: #f9edeb; }

.renameform { flex: 1; min-width: 0; }
.renameform input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: var(--card);
}

.settings { border-top: 1px solid var(--line); padding-top: 16px; }
.me { display: flex; align-items: center; gap: 9px; font-size: 13.5px; margin-bottom: 10px; }
.settingsbtn {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.settingsbtn:hover { border-color: var(--accent); color: var(--accent); }
</style>
