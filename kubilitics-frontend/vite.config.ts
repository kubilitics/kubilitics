import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
  server: {
    host: "::",
    // Use 5173 only; fail if port is in use instead of trying another
    port: 5173,
    strictPort: true,
    // Proxy API, WebSocket, and health to the MAIN backend (port 819).
    // The AI backend (port 8081) is called directly via absolute URLs (AI_BASE_URL in aiService.ts)
    // so no proxy entry is needed for it — that also avoids CORS issues in production.
    // Override with VITE_BACKEND_PORT env var if main backend runs on a different port.
    proxy: (() => {
      const port = process.env.VITE_BACKEND_PORT || "819";
      const target = `http://127.0.0.1:${port}`;
      const proxyOptions = (path: string) => ({
        target,
        changeOrigin: true,
        ...(path === "/api" ? { ws: true } : {}),
        configure: (proxy: { on: (ev: string, fn: () => void) => void }) => {
          proxy.on("error", () => {
            // Suppress proxy error logging (e.g. ECONNREFUSED when backend is down).
            // Frontend backs off polling when backend is unreachable; start backend with: make restart
          });
        },
      });
      return {
        "/api": proxyOptions("/api"),
        "/health": proxyOptions("/health"),
      };
    })(),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@i18n": path.resolve(__dirname, "./src/i18n"),
      "@tauri-apps/api/core": path.resolve(__dirname, "./src/mocks/tauri-core.ts"),
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: mode !== "production",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('framer-motion')) return 'vendor-animation';
            if (id.includes('@radix-ui')) return 'vendor-ui';
            if (id.includes('cytoscape') || id.includes('elkjs')) return 'vendor-graph';
            return 'vendor';
          }
        },
      },
    },
  },
}));
