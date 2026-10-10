#!/usr/bin/env node
// Cross-platform launcher for `npm run play:stairwell` — plain Node spawn
// instead of shell command substitution, since `$(...)` only works in
// bash/zsh and breaks outright on Windows cmd.exe/PowerShell.
import { spawnSync } from 'node:child_process'

const seed = `stairwell-${Date.now()}`

const result = spawnSync(
  'npx',
  ['tsx', 'src/cli/play.ts', seed, 'homicide', 'homicide-stairwell'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

process.exit(result.status ?? 1)
