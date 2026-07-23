<script setup lang="ts">
definePageMeta({
  // Bypass Supabase participant auth — this page uses the admin cookie.
})

type SharingCondition = 'default' | 'selective_sharing'

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
    value: 'default',
    label: 'Default',
    hint: 'All conversations are public to the team. Users cannot change sharing.',
  },
  {
    value: 'selective_sharing',
    label: 'Selective sharing',
    hint: 'Conversations start private. Users choose what to share with the team.',
  },
]

const authorized = ref(false)
const checking = ref(true)
const error = ref('')
const busy = ref(false)

const userId = ref('')
const sessionId = ref('')
const displayName = ref('')
const condition = ref<SharingCondition>('default')

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
  if (c === 'default') return 'Default'
  if (c === 'selective_sharing') return 'Selective sharing'
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

async function logout() {
  await $fetch('/api/admin/logout', { method: 'POST' })
  await navigateTo('/login')
}

/** Group users by session for the table section headers */
const bySession = computed(() => {
  const map = new Map<string, { condition: SharingCondition | null; users: StudyUser[] }>()
  for (const u of list.value?.users ?? []) {
    const key = u.sessionId || '(no session)'
    const entry = map.get(key) ?? { condition: u.sharingCondition, users: [] }
    entry.users.push(u)
    if (!entry.condition && u.sharingCondition) entry.condition = u.sharingCondition
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
          <h1>Admin · users & sessions</h1>
          <p class="hint">
            Users with the same Session ID are automatically placed on the same team.
            They sign in with User ID + Session ID. Condition is set per session.
          </p>
        </div>
        <div class="actions">
          <NuxtLink to="/login" class="back">Participant login</NuxtLink>
          <button type="button" class="signout" @click="logout">Sign out admin</button>
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
          <button type="submit" :disabled="busy">{{ busy ? 'Creating…' : 'Create' }}</button>
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
              <span class="badge">{{ conditionLabel(group.condition) }}</span>
              <span class="count">{{ group.users.length }} user{{ group.users.length === 1 ? '' : 's' }}</span>
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
                    <button
                      v-if="u.studyUserId"
                      type="button"
                      class="danger"
                      @click="removeUser(u)"
                    >
                      Delete
                    </button>
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
h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #444; }
.hint { margin: 6px 0 0; color: #666; font-size: 13px; max-width: 560px; line-height: 1.4; }
.actions { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
.back { color: #2f6feb; text-decoration: none; font-size: 13px; }
.signout {
  padding: 7px 12px;
  border: 1px solid #d7dbe0;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.create {
  padding: 18px;
  background: #fff;
  border: 1px solid #e8eaee;
  border-radius: 12px;
  margin-bottom: 28px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.1fr 1.2fr auto;
  gap: 10px;
  align-items: end;
}
label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: #555; }
label em { font-weight: 400; color: #999; font-style: normal; }
input, select {
  padding: 9px 10px;
  border: 1px solid #d7dbe0;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  color: #111;
  background: #fff;
  height: 38px;
  box-sizing: border-box;
}
select:disabled { opacity: 0.7; background: #f6f7f9; }
.cond-hint { margin: 10px 0 0; color: #666; font-size: 12.5px; line-height: 1.4; }
.create button[type='submit'] {
  padding: 9px 16px;
  border: 0;
  border-radius: 8px;
  background: #2f6feb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  height: 38px;
}
.create button:disabled { opacity: 0.6; }
.session-block { margin-bottom: 22px; }
.badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #edf1fd;
  color: #2f56d9;
  font-size: 11px;
  font-weight: 600;
}
.count { margin-left: 8px; color: #888; font-weight: 400; }
table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; }
th { color: #888; font-weight: 600; background: #fafbfc; }
code { font-size: 12.5px; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
.danger {
  border: 0;
  background: none;
  color: #c0392b;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.err { color: #c0392b; font-size: 13px; margin: 10px 0 0; }
.muted { color: #888; font-size: 13px; }

@media (max-width: 900px) {
  .row { grid-template-columns: 1fr 1fr; }
  header { flex-direction: column; }
}
</style>
