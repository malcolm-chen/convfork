<template>
  <div>
    <NuxtPage />
  </div>
</template>

<style>
:root {
  --paper: #f6f5f1;
  --card: #fffefb;
  --ink: #1d2029;
  --muted: #7a7466;
  --line: #e6e2d7;
  /* Stronger separators between major panels (nav / canvas / chat) */
  --panel-edge: #c4beaf;
  --accent: #2f56d9;
  --accent-soft: #edf1fd;
}
body {
  margin: 0;
  font-family: 'Instrument Sans', sans-serif;
  color: var(--ink);
  background: var(--paper);
}
</style>
