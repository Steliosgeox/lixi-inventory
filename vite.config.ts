import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: { sourcemap: false, rollupOptions: { output: { manualChunks: { tables: ['@tanstack/react-table/legacy'], dialogs: ['@radix-ui/react-dialog'], supabase: ['@supabase/supabase-js'] } } } },
})
