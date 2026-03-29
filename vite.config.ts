import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'copy-manifest',
      closeBundle() {
        const outDir = resolve(__dirname, 'dist/extension');
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }
        
        // Copy manifest
        const manifest = readFileSync(resolve(__dirname, 'src/extension/manifest.json'), 'utf-8');
        writeFileSync(resolve(outDir, 'manifest.json'), manifest);
        
        // Move sidepanel.html if it's nested
        const nestedHtml = resolve(outDir, 'src/extension/sidepanel.html');
        if (existsSync(nestedHtml)) {
          const content = readFileSync(nestedHtml, 'utf-8');
          writeFileSync(resolve(outDir, 'sidepanel.html'), content);
        }
      },
    },
  ],
  define: {
    '__API_BASE__': JSON.stringify(process.env.VITE_API_BASE_URL || 'http://localhost:8088'),
  },
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/extension/sidepanel.html'),
        background: resolve(__dirname, 'src/extension/background.ts'),
        content: resolve(__dirname, 'src/extension/content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'background' || chunkInfo.name === 'content'
            ? '[name].js'
            : 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
