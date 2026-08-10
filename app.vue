<template>
  <div>
    <NuxtPage />
  </div>
</template>

<style>
:root {
  --paper: #fafafa;
  --card: #ffffff;
  --ink: #17171a;
  --muted: #8a8a93;
  --line: #e7e7ec;
  /* Stronger separators between major panels (nav / canvas / chat) */
  --panel-edge: #e2e2e8;
  --accent: #6c5ce7;
  --accent-soft: #eef0fd;
  --danger: #a2453c;
  --danger-soft: #f9edeb;
  --highlight: #e0a020;

  /* Dark left rail (team + projects) */
  --nav-bg: #0e0e10;
  --nav-card: #1a1a1d;
  --nav-ink: #f5f5f7;
  --nav-muted: #9a9aa3;
  --nav-line: #262629;
  --nav-online: #2ecc71;
}
body {
  margin: 0;
  font-family: 'Instrument Sans', sans-serif;
  color: var(--ink);
  background: var(--paper);
}
</style>
