import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// Plain Vite uses an in-memory preview; the Tauri CLI loads the real host APIs.
// @ts-expect-error process is a nodejs global
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const browserMock = '/src/lib/tauri-mock.ts';

export default defineConfig({
  plugins: [react()],
	clearScreen: false,
	resolve: {
		alias: isTauri
			? []
			: [
					{ find: '@tauri-apps/api/core', replacement: browserMock },
					{ find: '@tauri-apps/plugin-opener', replacement: browserMock },
				],
	},
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
