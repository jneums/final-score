import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import environment from 'vite-plugin-environment';
import path from 'path';
import fs from 'fs';

const network = process.env.DFX_NETWORK || 'local';

function getCanisterIds() {
  const canisterIdsPath =
    network === 'local'
      ? path.resolve(__dirname, '..', '..', '..', '.dfx', network, 'canister_ids.json')
      : path.resolve(__dirname, '..', '..', '..', 'canister_ids.json');

  if (!fs.existsSync(canisterIdsPath)) {
    console.error("Could not find canister_ids.json. Make sure you've deployed.");
    return {};
  }

  try {
    const canisterIds = JSON.parse(fs.readFileSync(canisterIdsPath, 'utf-8'));
    return Object.entries(canisterIds).reduce(
      (acc, [name, ids]) => {
        const key = `CANISTER_ID_${name.toUpperCase()}`;
        const value = (ids as Record<string, string>)[network];
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );
  } catch (e) {
    console.error('Error parsing canister_ids.json:', e);
    return {};
  }
}

export default defineConfig(({ mode }) => {
  const canisterEnvVariables = getCanisterIds();
  const isDevelopment = mode !== 'production';

  console.log(`[VITE] Network: ${network}, Mode: ${mode}`);
  console.log('[VITE] Canister IDs:', canisterEnvVariables);

  return {
    plugins: [
      react(),
      environment({
        NODE_ENV: isDevelopment ? 'development' : 'production',
        DFX_NETWORK: network,
        ...canisterEnvVariables,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        buffer: 'buffer/',
        events: 'events/',
        stream: 'stream-browserify',
        util: 'util/',
        process: 'process/browser',
      },
    },
    optimizeDeps: {
      include: ['@dfinity/agent', '@dfinity/candid', '@dfinity/principal'],
    },
    define: {
      global: 'window',
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:4943',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          assetFileNames: `assets/[name]-[hash].[ext]`,
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['@radix-ui/react-slot', '@radix-ui/react-tabs'],
          },
        },
      },
    },
  };
});
