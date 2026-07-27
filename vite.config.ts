import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/mywin-rm200x/',
  server: {
    port: 5173,
    open: true,
  },
  // 资源统一通过 import.meta.glob 在构建时收集并发出，避免与 publicDir 冲突
});
