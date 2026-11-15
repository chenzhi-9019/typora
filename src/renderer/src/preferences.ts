import './styles/tokens.css'
import './styles/windows.css'

import { createApp } from 'vue'
import PreferencesWindow from './windows/PreferencesWindow.vue'
import { loadSettings } from './windows/windowsApi'

async function bootstrap(): Promise<void> {
  await loadSettings()
  createApp(PreferencesWindow).mount('#app')
}

void bootstrap()
