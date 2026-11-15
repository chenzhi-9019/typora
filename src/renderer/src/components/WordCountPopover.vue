<script setup lang="ts">
import { computed } from 'vue'
import { doc } from '@renderer/stores/document'
import { charCount, nonSpaceCharCount, wordCount } from '@renderer/stores/outline'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const paragraphs = computed(
  () => doc.content.split(/\n\s*\n/).filter((part) => part.trim().length > 0).length
)

const rows = computed(() => [
  { label: '词', value: wordCount.value },
  { label: '字符（含空格）', value: charCount.value },
  { label: '字符（不含空格）', value: nonSpaceCharCount.value },
  { label: '段落', value: paragraphs.value }
])
</script>

<template>
  <div v-if="open" class="ty-word-count" @click.stop>
    <div class="ty-word-count-title">字数统计</div>
    <div v-for="row in rows" :key="row.label" class="ty-word-count-row">
      <span>{{ row.label }}</span>
      <span class="ty-word-count-value">{{ row.value }}</span>
    </div>
    <button type="button" class="ty-word-count-close" @click="emit('close')">关闭</button>
  </div>
</template>
