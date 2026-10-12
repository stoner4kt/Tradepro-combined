import { defineConfig } from 'vite';

// Builds src/widget/index.ts as a zero-dependency IIFE bundle at public/widget.js
export default defineConfig({
  // publicDir is the same folder as outDir here — nothing extra to copy.
  publicDir: false,
  build: {
    lib: {
      entry: 'src/widget/index.ts',
      name: 'ReviewFlow',
      fileName: () => 'widget.js',
      formats: ['iife'],
    },
    outDir: 'public',
    emptyOutDir: false,
  },
});