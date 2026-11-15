import './styles/tokens.css'
import './styles/windows.css'

import { createApp } from 'vue'
import WelcomeWindow from './windows/WelcomeWindow.vue'
import { loadSettings } from './windows/windowsApi'

async function bootstrap(): Promise<void> {
  await loadSettings()
  createApp(WelcomeWindow).mount('#app')
}

void bootstrap()
