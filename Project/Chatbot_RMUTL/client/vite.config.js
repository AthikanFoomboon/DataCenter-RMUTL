import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tslibPath = path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js');

export default defineConfig({
  optimizeDeps: {
    include: ['tslib']
  },

  resolve: {
    alias: {
      tslib: tslibPath
    }
  },

  plugins: [react({
    babel: {
      plugins: [['babel-plugin-react-compiler']]
    }
  })]
});