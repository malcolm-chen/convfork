<script setup lang="ts">
definePageMeta({
  // Bypass Supabase participant auth — this page uses the admin cookie.
})

type SharingCondition = 'selective_sharing' | 'individual_llm'

interface StudyUser {
  id: string
  studyUserId: string | null
  displayName: string
  role: string | null
  teamId: string | null
  sessionId: string | null
  teamName: string | null
  sharingCondition: SharingCondition | null
  createdAt: string
}

const CONDITIONS: { value: SharingCondition; label: string; hint: string }[] = [
  {
    value: 'selective_sharing',
    label: 'Selective sharing',
    hint: 'Conversations start private. Users choose what to share with the team.',
  },
  {
    value: 'individual_llm',
    label: 'Individual LLM',
    hint: 'Users chat with the LLM on their own — no team panel, no canvas, no sharing.',
  },
]

const authorized = ref(false)
const checking = ref(true)
const error = ref('')
const busy = ref(false)

const userId = ref('')
const sessionId = ref('')
const displayName = ref('')
const condition = ref<SharingCondition>('selective_sharing')

const { data: list, refresh: refreshList } = await useAsyncData(
  'admin-users',
  () => $fetch<{ users: StudyUser[] }>('/api/admin/users'),
  { immediate: false },
)

onMounted(async () => {
  try {
    const me = await $fetch<{ ok: boolean }>('/api/admin/me')
    if (!me.ok) {
      await navigateTo('/login')
      return
    }
    authorized.value = true
    await refreshList()
  } catch {
    await navigateTo('/login')
  } finally {
    checking.value = false
  }
})

/** If this Session ID already exists, lock the condition to the session's value. */
const existingSessionCondition = computed(() => {
  const sid = sessionId.value.trim()
  if (!sid) return null
  const match = list.value?.users?.find((u) => u.sessionId === sid)
  return match?.sharingCondition ?? null
})

watch(existingSessionCondition, (c) => {
  if (c) condition.value = c
})

const conditionHint = computed(() => {
  if (existingSessionCondition.value) {
    return 'This session already exists — new users inherit its condition.'
  }
  return CONDITIONS.find((c) => c.value === condition.value)?.hint ?? ''
})

function conditionLabel(c: SharingCondition | null) {
  if (c === 'selective_sharing') return 'Selective sharing'
  if (c === 'individual_llm') return 'Individual LLM'
  return '—'
}

async function createUser() {
  error.value = ''
  busy.value = true
  try {
    await $fetch('/api/admin/users', {
      method: 'POST',
      body: {
        userId: userId.value.trim(),
        sessionId: sessionId.value.trim(),
        displayName: displayName.value.trim() || undefined,
        condition: condition.value,
      },
    })
    userId.value = ''
    displayName.value = ''
    // keep sessionId + condition so admins can batch-create a team quickly
    await refreshList()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Create failed'
  } finally {
    busy.value = false
  }
}

async function removeUser(u: StudyUser) {
  if (!confirm(`Delete user "${u.studyUserId || u.displayName}"?`)) return
  error.value = ''
  try {
    await $fetch('/api/admin/users', {
      method: 'DELETE',
      body: { id: u.id },
    })
    await refreshList()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Delete failed'
  }
}

async function deleteSession(sid: string, group: { teamId: string | null; users: StudyUser[] }) {
  if (!group.teamId) return
  const count = group.users.length
  if (
    !confirm(
      `Delete session "${sid}" and ALL its data — ${count} user${count === 1 ? '' : 's'}, ` +
        `their conversations, messages, and reactions? This cannot be undone. ` +
        `The Session ID becomes free again immediately, so you can recreate it with a different condition.`,
    )
  ) {
    return
  }
  error.value = ''
  busy.value = true
  try {
    await $fetch('/api/admin/sessions', {
      method: 'DELETE',
      body: { teamId: group.teamId },
    })
    await refreshList()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Delete session failed'
  } finally {
    busy.value = false
  }
}

async function logout() {
  await $fetch('/api/admin/logout', { method: 'POST' })
  await navigateTo('/login')
}

/** Group users by session for the table section headers */
const bySession = computed(() => {
  const map = new Map<string, { teamId: string | null; condition: SharingCondition | null; users: StudyUser[] }>()
  for (const u of list.value?.users ?? []) {
    const key = u.sessionId || '(no session)'
    const entry = map.get(key) ?? { teamId: u.teamId, condition: u.sharingCondition, users: [] }
    entry.users.push(u)
    if (!entry.condition && u.sharingCondition) entry.condition = u.sharingCondition
    if (!entry.teamId && u.teamId) entry.teamId = u.teamId
    map.set(key, entry)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
})
</script>

<template>
  <div class="wrap">
    <p v-if="checking" class="muted">Checking admin session…</p>

    <template v-else-if="authorized">
      <header>
        <div>
          <h1>Admin: users & sessions</h1>
          <p class="hint">
            Users with the same Session ID are automatically placed on the same team.
            They sign in with User ID + Session ID. Condition is set per session.
          </p>
        </div>
        <div class="actions">
          <NuxtLink to="/login" class="back">Participant login</NuxtLink>
          <UiButton type="button" variant="ghost" size="sm" @click="logout">Sign out admin</UiButton>
        </div>
      </header>

      <form class="create" @submit.prevent="createUser">
        <h2>Create user</h2>
        <div class="row">
          <label>
            <span>User ID</span>
            <input v-model="userId" required placeholder="p01" />
          </label>
          <label>
            <span>Session ID</span>
            <input v-model="sessionId" required placeholder="session-A" minlength="6" />
          </label>
          <label>
            <span>Condition</span>
            <select
              v-model="condition"
              required
              :disabled="!!existingSessionCondition"
            >
              <option v-for="c in CONDITIONS" :key="c.value" :value="c.value">
                {{ c.label }}
              </option>
            </select>
          </label>
          <label>
            <span>Display name <em>(optional)</em></span>
            <input v-model="displayName" placeholder="defaults to User ID" />
          </label>
          <UiButton type="submit" class="submitbtn" :disabled="busy">{{ busy ? 'Creating…' : 'Create' }}</UiButton>
        </div>
        <p class="cond-hint">{{ conditionHint }}</p>
        <p v-if="error" class="err">{{ error }}</p>
      </form>

      <section class="list">
        <h2>Provisioned users</h2>
        <template v-if="bySession.length">
          <div v-for="[sid, group] in bySession" :key="sid" class="session-block">
            <h3>
              Session <code>{{ sid }}</code>
              <UiBadge class="badge">{{ conditionLabel(group.condition) }}</UiBadge>
              <span class="count">{{ group.users.length }} user{{ group.users.length === 1 ? '' : 's' }}</span>
              <UiButton
                v-if="group.teamId"
                type="button"
                variant="danger"
                size="sm"
                class="delete-session"
                :disabled="busy"
                @click="deleteSession(sid, group)"
              >
                Delete session
              </UiButton>
            </h3>
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Display name</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in group.users" :key="u.id">
                  <td><code>{{ u.studyUserId || '—' }}</code></td>
                  <td>{{ u.displayName }}</td>
                  <td>{{ new Date(u.createdAt).toLocaleString() }}</td>
                  <td>
                    <UiButton
                      v-if="u.studyUserId"
                      type="button"
                      variant="danger"
                      size="sm"
                      @click="removeUser(u)"
                    >
                      Delete
                    </UiButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <p v-else class="muted">No users yet — create one above.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 960px; margin: 0 auto; padding: 28px 24px 64px; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
h1 { margin: 0; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 15px; }
h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--ink); }
.hint { margin: 6px 0 0; color: var(--muted); font-size: 13px; max-width: 560px; line-height: 1.4; }
.actions { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
.back { color: var(--accent); text-decoration: none; font-size: 13px; }
.create {
  padding: 18px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-bottom: 28px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.1fr 1.2fr auto;
  gap: 10px;
  align-items: end;
}
label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink); }
label em { font-weight: 400; color: var(--muted); font-style: normal; }
input, select {
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  color: var(--ink);
  background: var(--card);
  height: 38px;
  box-sizing: border-box;
}
select:disabled { opacity: 0.7; background: var(--paper); }
.cond-hint { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
.submitbtn { height: 38px; }
.session-block { margin-bottom: 22px; }
.badge { margin-left: 8px; }
.count { margin-left: 8px; color: var(--muted); font-weight: 400; }
.delete-session { margin-left: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; background: var(--paper); }
code { font-size: 12.5px; background: var(--line); padding: 2px 6px; border-radius: 4px; }
.err { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
.muted { color: var(--muted); font-size: 13px; }

@media (max-width: 900px) {
  .row { grid-template-columns: 1fr 1fr; }
  header { flex-direction: column; }
}
</style>
