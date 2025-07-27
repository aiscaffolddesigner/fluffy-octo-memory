import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Get the repository name from environment variable or set manually
// For a project page, the base should be /<repository-name>/
const repoName = 'fluffy-octo-memory'; // <-- This must match your GitHub repository name exactly
const isGithubPages = process.env.NODE_ENV === 'production' && process.env.VITE_DEPLOY_TARGET === 'github-pages';

export default defineConfig({
  plugins: [react()],
  base: isGithubPages ? `/${repoName}/` : '/', // Set base path for GitHub Pages
  build: {
    outDir: 'dist', // Default build output directory
  },
});
