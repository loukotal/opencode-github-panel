import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

const source = (file: string) => fileURLToPath(new URL(file, import.meta.url))
const UNUSED = "\0ghp-unused"

// TanStack Query reads process.env.NODE_ENV, which windows do not have; the main process does, but the value is fixed
// for both.
export default defineConfig({
  plugins: [
    gui(),
    {
      // The app loads one file with every dynamic import inlined, so what @pierre/diffs would load on demand ships in it
      // whether used or not. The diff uses Shiki's JavaScript engine, so the other highlighter and the WebAssembly engine
      // are left out.
      name: "ghp-unused",
      enforce: "pre",
      resolveId: (id) => (/^@pierre\/highlights(\/|$)|^shiki\/wasm$/.test(id) ? { id: UNUSED, syntheticNamedExports: "unused" } : undefined),
      load: (id) => (id === UNUSED ? "export const unused = {}; export default {}" : undefined),
    },
  ],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "shiki/langs": source("src/langs.ts"), "@pierre/theming/themes": source("src/themes.ts") } },
})
