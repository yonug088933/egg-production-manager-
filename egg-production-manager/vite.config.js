import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // 코드 분할 - 라이브러리들을 별도 청크로
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase': ['firebase/app', 'firebase/firestore'],
          'recharts': ['recharts'],
          'icons': ['lucide-react']
        }
      }
    },
    // 청크 크기 경고 한도 늘림
    chunkSizeWarningLimit: 1000,
    // 압축 (esbuild가 더 빠름)
    minify: 'esbuild'
  }
})
