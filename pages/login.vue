<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()

type Mode = 'participant' | 'admin'
const mode = ref<Mode>('participant')

const userId = ref('')
const sessionId = ref('')
const adminPassword = ref('')
const error = ref('')
const busy = ref(false)

// already signed in as a participant → go home
watchEffect(() => {
  if (user.value && mode.value === 'participant') navigateTo('/')
})

function switchMode(next: Mode) {
  mode.value = next
  error.value = ''
}

async function participantLogin() {
  error.value = ''
  busy.value = true
  try {
    const creds = await $fetch<{ email: string; password: string }>('/api/auth/session-login', {
      method: 'POST',
      body: { userId: userId.value.trim(), sessionId: sessionId.value.trim() },
    })
    const { error: e } = await supabase.auth.signInWithPassword(creds)
    if (e) throw new Error(e.message)
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Login failed'
  } finally {
    busy.value = false
  }
}

async function adminLogin() {
  error.value = ''
  busy.value = true
  try {
    await $fetch('/api/admin/login', {
      method: 'POST',
      body: { password: adminPassword.value },
    })
    await navigateTo('/admin')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Admin login failed'
  } finally {
    busy.value = false
  }
}

async function testLogin() {
  error.value = ''
  busy.value = true
  try {
    const creds = await $fetch<{ email: string; password: string }>('/api/auth/test-login', {
      method: 'POST',
    })
    const { error: e } = await supabase.auth.signInWithPassword(creds)
    if (e) throw new Error(e.message)
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Test login failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <form
      v-if="mode === 'participant'"
      class="card"
      @submit.prevent="participantLogin"
    >
      <h1>ConvFork</h1>
      <p class="sub">Sign in with your study credentials</p>

      <label>
        <span>User ID</span>
        <input
          v-model="userId"
          type="text"
          placeholder="p01"
          autocomplete="username"
          required
        />
      </label>
      <label>
        <span>Session ID</span>
        <input
          v-model="sessionId"
          type="text"
          placeholder="sessionA"
          autocomplete="current-password"
          required
        />
      </label>

      <button :disabled="busy" type="submit">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>

      <div class="divider"><span>or</span></div>
      <button type="button" class="test" :disabled="busy" @click="testLogin">
        Test login (full-access account)
      </button>

      <p v-if="error" class="err">{{ error }}</p>

      <button type="button" class="admin-link" @click="switchMode('admin')">
        Admin login
      </button>
    </form>

    <form
      v-else
      class="card"
      @submit.prevent="adminLogin"
    >
      <h1>Admin</h1>
      <p class="sub">Create users and assign study sessions</p>

      <label>
        <span>Admin password</span>
        <input
          v-model="adminPassword"
          type="password"
          placeholder="admin password"
          autocomplete="current-password"
          required
        />
      </label>

      <button :disabled="busy" type="submit">
        {{ busy ? 'Checking…' : 'Enter admin' }}
      </button>

      <p v-if="error" class="err">{{ error }}</p>

      <button type="button" class="admin-link" @click="switchMode('participant')">
        ← Back to participant login
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  background: #f6f7f9;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  padding: 28px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
}
h1 { margin: 0; font-size: 22px; }
.sub { margin: 0 0 8px; color: #666; font-size: 13px; }
label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #555; font-weight: 600; }
input {
  padding: 10px;
  border: 1px solid #d7dbe0;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  color: #111;
}
button[type='submit'] {
  margin-top: 4px;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: #2f6feb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: default; }
.divider {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
  font-size: 12px;
  margin: 4px 0;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e3e6ea;
}
.test {
  padding: 10px;
  border: 1px solid #2f6feb;
  border-radius: 8px;
  background: #fff;
  color: #2f6feb;
  font-weight: 600;
  cursor: pointer;
}
.admin-link {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: #666;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
}
.admin-link:hover { color: #2f6feb; }
.err { color: #c0392b; font-size: 13px; margin: 4px 0 0; }
</style>
