import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = 'fluffy-octo-memory'; // <-- This must match your GitHub repository name exactly

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`, // Set base path directly for manual GitHub Pages upload
  build: {
    outDir: 'dist', // Default build output directory
  },
});