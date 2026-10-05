import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
await viteBuild({
  root: "apps/web",
  publicDir: "../../public",
  build: { outDir: "../../dist", emptyOutDir: true },
});
await build({
  entryPoints: ["cloudflare/worker/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
});
await writeFile(
  "dist/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*", "/health"], exclude: [] }),
);
