import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: if you deploy to GitHub Pages as a project site
  // (https://<user>.github.io/<repo-name>/), set base to '/<repo-name>/'.
  // If you deploy to a custom domain or a user/org root site, leave it as '/'.
  base: '/QC-Tracker/',
})
