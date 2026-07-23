// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

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
      // /admin is gated by the study-admin cookie, not a participant Supabase session.
      exclude: ['/login', '/admin'],
    },
  },

  runtimeConfig: {
    // server-only (never exposed to the client bundle)
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY, // new-format secret key (replaces service_role)
    adminPassword: process.env.ADMIN_PASSWORD, // study admin UI (create users / assign sessions)
    supabaseJwksUrl: process.env.SUPABASE_JWKS_URL,
    litellmBaseUrl: process.env.LITELLM_BASE_URL,
    litellmApiKey: process.env.LITELLM_API_KEY,
    llmModel: process.env.LLM_MODEL || 'claude-opus-4-8',
    awsRegion: process.env.AWS_REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET,
    public: {},
  },

  vite: {
    // 'cookie' (dep of @supabase/ssr) is CJS-only; without prebundling, Vite dev
    // serves it raw and its named exports fail ESM analysis, breaking hydration.
    optimizeDeps: { include: ['cookie'] },
  },

  nitro: {
    // Always-on Node host (e.g. Lightsail) — clean SSE, no serverless timeout.
    preset: 'node-server',
  },
})
