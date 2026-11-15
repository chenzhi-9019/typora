<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { THEME_LABELS, THEME_NAMES } from '@shared/menu'
import type { ThemeName } from '@shared/types'
import {
  appVersion,
  closeWindow,
  openExternalUrl,
  patchSettings,
  revealPath,
  settings
} from './windowsApi'

interface GuideLink {
  title: string
  url: string
}

/** locales/zh-Hans.lproj/Welcome.json drives the wording, support.typora.io the targets. */
const GUIDE_LINKS: GuideLink[] = [
  { title: '新手教程', url: 'https://support.typora.io/Quick-Start/' },
  { title: 'Markdown 语法说明', url: 'https://support.typora.io/Markdown-Reference/' },
  { title: '浏览主题', url: 'http://theme.typora.io' },
  { title: '更多帮助', url: 'https://support.typora.io' }
]

const version = ref('')

const themeModel = computed<string>({
  get: () => settings.theme,
  set: (value) => {
    void patchSettings({ theme: value as ThemeName })
  }
})

function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function folder(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut > 0 ? path.slice(0, cut) : path
}

function open(url: string): void {
  void openExternalUrl(url)
}

function reveal(path: string): void {
  void revealPath(path)
}

function close(): void {
  void closeWindow()
}

onMounted(async () => {
  version.value = await appVersion()
})
</script>

<template>
  <div class="welcome">
    <div class="welcome-main">
      <div class="welcome-left">
        <svg
          class="welcome-logo"
          viewBox="0 0 72 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="9" y="5" width="54" height="62" rx="7" stroke="currentColor" stroke-width="3" />
          <path
            d="M22 22h30M22 32h30M22 42h18"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="welcome-right">
        <h1>欢迎使用 Typora</h1>
        <p class="welcome-intro">
          感谢您使用 Typora 👋。 Typora 是一个极简风格的 Markdown
          编辑器和阅读器，可以提供无缝的编辑和阅读体验。
        </p>

        <section class="welcome-section">
          <h2 class="welcome-section-title">主题</h2>
          <p class="welcome-hint">使用您喜欢的主题，或者自己定制一个主题。</p>
          <div class="grid">
            <button
              v-for="name in THEME_NAMES"
              :key="name"
              :class="[
                'feature-item',
                'feature-item-' + name,
                name === settings.theme ? 'active' : ''
              ]"
              type="button"
              @click="themeModel = name"
            >
              <span class="feature-item-title">{{ THEME_LABELS[name] }}</span>
            </button>
          </div>
        </section>

        <section class="welcome-section">
          <h2 class="welcome-section-title">最近使用的文件</h2>
          <p v-if="settings.recentFiles.length === 0" class="welcome-hint">
            还没有最近使用的文件。打开或新建一个 Markdown 文档后，它会出现在这里。
          </p>
          <ul v-else class="guide-list">
            <li v-for="path in settings.recentFiles" :key="path">
              <button class="guide-item" type="button" @click="reveal(path)">
                <span class="guide-item-title">{{ fileName(path) }}</span>
                <span class="desc">{{ folder(path) }}</span>
                <span class="guide-item-link">↗</span>
              </button>
            </li>
          </ul>
          <p v-if="settings.lastOpenedFolder" class="welcome-hint">
            上次打开的目录：{{ settings.lastOpenedFolder }}
          </p>
        </section>

        <section class="welcome-section">
          <h2 class="welcome-section-title">快速上手</h2>
          <p class="welcome-hint">如果您未了解过 Markdown 或 Typora，可以点击下列链接了解详情。</p>
          <ul class="guide-list">
            <li v-for="link in GUIDE_LINKS" :key="link.url">
              <button class="guide-item" type="button" @click="open(link.url)">
                <span class="guide-item-title">{{ link.title }}</span>
                <span class="guide-item-link">↗</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div class="welcome-footer">
      <div class="welcome-footer-left">
        <span v-if="version">Typora {{ version }}</span>
      </div>
      <div class="welcome-footer-right">
        <button class="default-btn" type="button" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>
