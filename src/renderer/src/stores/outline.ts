import { ref } from 'vue'
import type { OutlineItem } from '@renderer/editor'

export const outline = ref<OutlineItem[]>([])
export const wordCount = ref(0)
export const charCount = ref(0)
export const nonSpaceCharCount = ref(0)
