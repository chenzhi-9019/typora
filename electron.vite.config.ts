import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const alias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          preferences: resolve('src/renderer/preferences.html'),
          welcome: resolve('src/renderer/welcome.html')
        }
      }
    }
  }
})
