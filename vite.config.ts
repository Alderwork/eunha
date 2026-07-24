import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// The Tauri CLI sets TAURI_ENV_* vars when it spawns the dev server. When
// they're absent we're in a plain browser (`pnpm dev`) — alias the Tauri
// modules to a mock so the UI renders with fixture/exported data.
// @ts-expect-error process is a nodejs global
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const browserMock = '/src/lib/tauri-mock.ts';

export default defineConfig({
  plugins: [react(), tailwindcss()],
	clearScreen: false,
	// conduit 패키지를 link:로 쓰므로 react가 두 벌 로드되지 않도록 강제
	resolve: {
		dedupe: ['react', 'react-dom'],
		alias: isTauri
			? []
			: [
					{ find: '@tauri-apps/api/core', replacement: browserMock },
					{ find: '@tauri-apps/api/event', replacement: browserMock },
					{ find: '@tauri-apps/api/window', replacement: browserMock },
					{ find: '@tauri-apps/plugin-opener', replacement: browserMock },
					{ find: '@tauri-apps/plugin-clipboard-manager', replacement: browserMock },
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
