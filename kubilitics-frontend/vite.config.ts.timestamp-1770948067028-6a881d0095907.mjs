// vite.config.ts
import { defineConfig } from "file:///sessions/dreamy-confident-euler/mnt/kubilitics-os-emergent/kubilitics-frontend/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/dreamy-confident-euler/mnt/kubilitics-os-emergent/kubilitics-frontend/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///sessions/dreamy-confident-euler/mnt/kubilitics-os-emergent/kubilitics-frontend/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/sessions/dreamy-confident-euler/mnt/kubilitics-os-emergent/kubilitics-frontend";
var vite_config_default = defineConfig(({ mode }) => ({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"]
  },
  server: {
    host: "::",
    // Use 5173 only; fail if port is in use instead of trying another
    port: 5173,
    strictPort: true,
    // Proxy API, WebSocket, and health to backend so dev uses same-origin (no cross-origin WS errors)
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true
      },
      "/health": {
        target: "http://localhost:8080",
        changeOrigin: true
      }
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src"),
      "@components": path.resolve(__vite_injected_original_dirname, "./src/components"),
      "@features": path.resolve(__vite_injected_original_dirname, "./src/features"),
      "@hooks": path.resolve(__vite_injected_original_dirname, "./src/hooks"),
      "@stores": path.resolve(__vite_injected_original_dirname, "./src/stores"),
      "@services": path.resolve(__vite_injected_original_dirname, "./src/services"),
      "@types": path.resolve(__vite_injected_original_dirname, "./src/types"),
      "@utils": path.resolve(__vite_injected_original_dirname, "./src/utils"),
      "@lib": path.resolve(__vite_injected_original_dirname, "./src/lib"),
      "@i18n": path.resolve(__vite_injected_original_dirname, "./src/i18n")
    }
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: mode !== "production",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-graph": ["cytoscape", "cytoscape-dagre", "cytoscape-cola", "cytoscape-elk", "elkjs"],
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-tabs"]
        }
      }
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvZHJlYW15LWNvbmZpZGVudC1ldWxlci9tbnQva3ViaWxpdGljcy1vcy1lbWVyZ2VudC9rdWJpbGl0aWNzLWZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvZHJlYW15LWNvbmZpZGVudC1ldWxlci9tbnQva3ViaWxpdGljcy1vcy1lbWVyZ2VudC9rdWJpbGl0aWNzLWZyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9kcmVhbXktY29uZmlkZW50LWV1bGVyL21udC9rdWJpbGl0aWNzLW9zLWVtZXJnZW50L2t1YmlsaXRpY3MtZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XG4gIHRlc3Q6IHtcbiAgICBpbmNsdWRlOiBbJ3NyYy8qKi8qLnRlc3Que3RzLHRzeH0nXSxcbiAgICBleGNsdWRlOiBbJ2UyZS8qKicsICdub2RlX21vZHVsZXMvKionXSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogXCI6OlwiLFxuICAgIC8vIFVzZSA1MTczIG9ubHk7IGZhaWwgaWYgcG9ydCBpcyBpbiB1c2UgaW5zdGVhZCBvZiB0cnlpbmcgYW5vdGhlclxuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICAvLyBQcm94eSBBUEksIFdlYlNvY2tldCwgYW5kIGhlYWx0aCB0byBiYWNrZW5kIHNvIGRldiB1c2VzIHNhbWUtb3JpZ2luIChubyBjcm9zcy1vcmlnaW4gV1MgZXJyb3JzKVxuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo4MDgwJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICB3czogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAnL2hlYWx0aCc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo4MDgwJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpXS5maWx0ZXIoQm9vbGVhbiksXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICBcIkBjb21wb25lbnRzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvY29tcG9uZW50c1wiKSxcbiAgICAgIFwiQGZlYXR1cmVzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvZmVhdHVyZXNcIiksXG4gICAgICBcIkBob29rc1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL2hvb2tzXCIpLFxuICAgICAgXCJAc3RvcmVzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvc3RvcmVzXCIpLFxuICAgICAgXCJAc2VydmljZXNcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9zZXJ2aWNlc1wiKSxcbiAgICAgIFwiQHR5cGVzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvdHlwZXNcIiksXG4gICAgICBcIkB1dGlsc1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL3V0aWxzXCIpLFxuICAgICAgXCJAbGliXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvbGliXCIpLFxuICAgICAgXCJAaTE4blwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL2kxOG5cIiksXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICB0YXJnZXQ6IFwiZXNuZXh0XCIsXG4gICAgbWluaWZ5OiBcImVzYnVpbGRcIixcbiAgICBzb3VyY2VtYXA6IG1vZGUgIT09IFwicHJvZHVjdGlvblwiLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICBcInZlbmRvci1yZWFjdFwiOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcInJlYWN0LXJvdXRlci1kb21cIl0sXG4gICAgICAgICAgXCJ2ZW5kb3ItcXVlcnlcIjogW1wiQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5XCJdLFxuICAgICAgICAgIFwidmVuZG9yLWdyYXBoXCI6IFtcImN5dG9zY2FwZVwiLCBcImN5dG9zY2FwZS1kYWdyZVwiLCBcImN5dG9zY2FwZS1jb2xhXCIsIFwiY3l0b3NjYXBlLWVsa1wiLCBcImVsa2pzXCJdLFxuICAgICAgICAgIFwidmVuZG9yLXVpXCI6IFtcIkByYWRpeC11aS9yZWFjdC1kaWFsb2dcIiwgXCJAcmFkaXgtdWkvcmVhY3QtdGFic1wiXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBK1osU0FBUyxvQkFBb0I7QUFDNWIsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUhoQyxJQUFNLG1DQUFtQztBQU16QyxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssT0FBTztBQUFBLEVBQ3pDLE1BQU07QUFBQSxJQUNKLFNBQVMsQ0FBQyx3QkFBd0I7QUFBQSxJQUNsQyxTQUFTLENBQUMsVUFBVSxpQkFBaUI7QUFBQSxFQUN2QztBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBO0FBQUEsSUFFTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUE7QUFBQSxJQUVaLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxRQUNkLElBQUk7QUFBQSxNQUNOO0FBQUEsTUFDQSxXQUFXO0FBQUEsUUFDVCxRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsTUFDaEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUyxDQUFDLE1BQU0sR0FBRyxTQUFTLGlCQUFpQixnQkFBZ0IsQ0FBQyxFQUFFLE9BQU8sT0FBTztBQUFBLEVBQzlFLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxNQUNwQyxlQUFlLEtBQUssUUFBUSxrQ0FBVyxrQkFBa0I7QUFBQSxNQUN6RCxhQUFhLEtBQUssUUFBUSxrQ0FBVyxnQkFBZ0I7QUFBQSxNQUNyRCxVQUFVLEtBQUssUUFBUSxrQ0FBVyxhQUFhO0FBQUEsTUFDL0MsV0FBVyxLQUFLLFFBQVEsa0NBQVcsY0FBYztBQUFBLE1BQ2pELGFBQWEsS0FBSyxRQUFRLGtDQUFXLGdCQUFnQjtBQUFBLE1BQ3JELFVBQVUsS0FBSyxRQUFRLGtDQUFXLGFBQWE7QUFBQSxNQUMvQyxVQUFVLEtBQUssUUFBUSxrQ0FBVyxhQUFhO0FBQUEsTUFDL0MsUUFBUSxLQUFLLFFBQVEsa0NBQVcsV0FBVztBQUFBLE1BQzNDLFNBQVMsS0FBSyxRQUFRLGtDQUFXLFlBQVk7QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLFdBQVcsU0FBUztBQUFBLElBQ3BCLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxVQUNaLGdCQUFnQixDQUFDLFNBQVMsYUFBYSxrQkFBa0I7QUFBQSxVQUN6RCxnQkFBZ0IsQ0FBQyx1QkFBdUI7QUFBQSxVQUN4QyxnQkFBZ0IsQ0FBQyxhQUFhLG1CQUFtQixrQkFBa0IsaUJBQWlCLE9BQU87QUFBQSxVQUMzRixhQUFhLENBQUMsMEJBQTBCLHNCQUFzQjtBQUFBLFFBQ2hFO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
