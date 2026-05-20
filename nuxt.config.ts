import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url).pathname, 'utf-8')) as { version: string }

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['@nuxtjs/mcp-toolkit', '@bitrix24/b24jssdk-nuxt', '@bitrix24/b24ui-nuxt', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  mcp: {
    route: '/mcp',
    name: 'bx24-template-mcp',
    version,
  },

  runtimeConfig: {
    bitrix24WebhookUrl: '',
    mcpAuthToken: '',
    githubFeedbackToken: '',
    githubFeedbackRepo: 'bitrix24/templates-mcp',
    logLevel: 'info',
  },

  nitro: {
    preset: 'node-server',
  },

  typescript: {
    strict: true,
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        forceConsistentCasingInFileNames: true,
      },
    },
  },
})
