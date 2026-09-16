import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
  // the IDL, chat config and gear list live in the app/program folders
  server: { fs: { allow: ['..'] } },
  base: './',
  build: { target: 'es2022' },
});
