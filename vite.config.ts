import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  cpSync,
  rmSync,
} from 'fs';

const isFirefox = process.env.TARGET === 'firefox';
const outDir = resolve(__dirname, isFirefox ? 'dist/extension-firefox' : 'dist/extension');

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'extension-plugin',
      closeBundle() {
        // Ensure output directory exists
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }

        // Select manifest based on target
        const manifestSrc = resolve(
          __dirname,
          isFirefox ? 'src/extension/manifest.firefox.json' : 'src/extension/manifest.json'
        );
        const manifestDest = resolve(outDir, 'manifest.json');
        copyFileSync(manifestSrc, manifestDest);

        // Copy static files
        const staticFiles = ['index.css', 'assets'];
        for (const file of staticFiles) {
          const src = resolve(__dirname, 'src/extension', file);
          const dest = resolve(outDir, file);
          if (existsSync(src)) {
            if (file === 'assets') {
              cpSync(src, dest, { recursive: true });
            } else {
              copyFileSync(src, dest);
            }
          }
        }

        // Fix sidepanel.html location (Vite puts it in nested dirs)
        const nestedHtml = resolve(outDir, 'src/extension/sidepanel.html');
        if (existsSync(nestedHtml)) {
          const content = readFileSync(nestedHtml, 'utf-8');
          writeFileSync(resolve(outDir, 'sidepanel.html'), content);
        }

        // Clean up nested directories
        const nestedSrcDir = resolve(outDir, 'src');
        if (existsSync(nestedSrcDir)) {
          try {
            rmSync(nestedSrcDir, { recursive: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      },
    },
  ],
  define: {
    __API_BASE__: JSON.stringify(process.env.VITE_API_BASE_URL || 'http://localhost:8088'),
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/extension/sidepanel.html'),
        background: resolve(
          __dirname,
          isFirefox ? 'src/extension/background-firefox.ts' : 'src/extension/background.ts'
        ),
        content: resolve(__dirname, 'src/extension/content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'background' || chunkInfo.name === 'content'
            ? '[name].js'
            : 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return '[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
