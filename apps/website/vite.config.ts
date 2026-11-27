import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    {
      // A per-build stamp in the document. Cloudflare Pages caches HTML for 7 days by
      // default and `_headers` does not reach an object that is already cached, so the
      // only way to retire a stale copy is to change the resource itself.
      name: "diffs-build-stamp",
      transformIndexHtml(html: string) {
        // Register the offline worker. It is skipped on localhost previews so a stale cache can
        // never confuse development; production is where "works offline" has to hold.
        const register = `
    <script>
      if ("serviceWorker" in navigator && location.protocol === "https:") {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/sw.js").catch(() => {});
        });
      }
    </script>`;
        return html
          .replace("__BUILD_STAMP__", new Date().toISOString())
          .replace("</body>", `${register}\n  </body>`);
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        // One chunk per file family so the landing page never pays for a renderer.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("lucide-react")) return "icons";
          return undefined;
        },
      },
    },
  },
  server: { fs: { allow: [root, fileURLToPath(new URL("../../", import.meta.url))] } },
});