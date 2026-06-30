<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main>
    <h1>base-box ⚡️ Vue</h1>
    <button @click="count++">count is {{ count }}</button>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui;
  padding: 3rem;
  text-align: center;
}
button {
  font: inherit;
  padding: 0.5rem 1rem;
  cursor: pointer;
}
</style>
