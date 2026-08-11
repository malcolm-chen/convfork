// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  // Python uv venv at repo root — Nuxt's dev watcher recurses into new dirs and will
  // attach ~20k+ watchers here unless excluded (EMFILE on macOS).
  ignore: ['**/.venv', '**/.venv/**', '**/__pycache__/**'],

  modules: ['@nuxtjs/supabase'],

  app: {
    head: {
      title: 'ConvFork',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Instrument+Sans:wght@400;500;600&display=swap',
        },
      ],
    },
  },

  // Register components by bare filename (no directory prefix) — the app refers to
  // them flat, e.g. <ReasoningTree>, <Composer>, <ReactionBar>, <ForkButton>.
  // Without this, Nuxt names nested components <TreeReasoningTree>/<ThreadComposer>
  // etc., which silently fail to resolve and render as empty comments.
  components: [{ path: '~/components', pathPrefix: false }],

  css: [
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
    // Self-hosted (not on Google Fonts) — used for conversation node titles.
    '@fontsource/geist/600.css',
    '@fontsource/geist/700.css',
  ],

  // @nuxtjs/supabase injects useSupabaseClient() / serverSupabaseUser() and
  // guards routes (everything redirects to /login unless excluded). We pass the
  // new-format publishable key as the client key (replaces the legacy anon key).
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      // /admin is gated by the study-admin cookie, not a participant Supabase
      // session; /share/* links are public/unauthenticated by design (see
      // pages/share/[id].vue).
      exclude: ['/login', '/admin', '/share/*'],
    },
  },

  runtimeConfig: {
    // server-only (never exposed to the client bundle)
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY, // new-format secret key (replaces service_role)
    adminPassword: process.env.ADMIN_PASSWORD, // study admin UI (create users / assign sessions)
    supabaseJwksUrl: process.env.SUPABASE_JWKS_URL,
    litellmBaseUrl: process.env.LITELLM_BASE_URL,
    litellmApiKey: process.env.LITELLM_API_KEY,
    awsRegion: process.env.AWS_REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET,
    public: {
      // Booleans only (never the keys themselves) — lets the composer's model
      // dropdown show only backbones this deployment can actually serve.
      hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    },
  },

  vite: {
    // 'cookie' (dep of @supabase/ssr) is CJS-only; without prebundling, Vite dev
    // serves it raw and its named exports fail ESM analysis, breaking hydration.
    optimizeDeps: { include: ['cookie'] },
    server: {
      // .venv lives in repo root for Python tooling; Vite only ignores node_modules/.git by default.
      watch: { ignored: ['**/.venv/**', '**/__pycache__/**'] },
    },
  },

  nitro: {
    // Always-on Node host (e.g. Lightsail) — clean SSE, no serverless timeout.
    preset: 'node-server',
    // The chat system prompt lives as a plain .txt file (see
    // server/utils/lineage.ts) so it can be edited without touching code.
    // Bundled via Nitro's asset system rather than a raw fs path so it
    // survives `nuxt build` (the output dir doesn't mirror the source tree).
    serverAssets: [{ baseName: 'prompts', dir: './server/assets/prompts' }],
  },
})
