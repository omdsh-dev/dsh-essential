import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    remote: 'lib/types/remote.js',
    typert: 'lib/types/typert.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['zod'] },
})
