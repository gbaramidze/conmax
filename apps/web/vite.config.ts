import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// DEV_HTTPS=1: самоподписанный сертификат, чтобы микрофон и камера работали и по адресу в сети (с телефона).
// Браузер один раз предупредит о сертификате — это нормально для разработки.
const https = process.env.DEV_HTTPS === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    ...(https ? [basicSsl()] : []),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    // доступ с других устройств сети: http://<адрес этого компьютера>:5173
    host: true,
    // API Supabase отдаётся через тот же адрес, чтобы телефону не нужен был доступ к 127.0.0.1 компьютера
    proxy: {
      '/supabase': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/supabase/, ''),
      },
    },
  },
})
