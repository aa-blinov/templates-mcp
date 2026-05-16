// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['@nuxtjs/mcp-toolkit', '@bitrix24/b24jssdk-nuxt'],

  mcp: {
    endpoint: '/mcp',
    name: 'bx24-mcp',
    version: '0.1.0',
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
  },
})
