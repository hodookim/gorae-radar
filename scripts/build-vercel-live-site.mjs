import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appPages } from "./app-pages.mjs";
import { contentPages } from "./content-pages.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");
const apiDir = join(root, "api");
const outDir = join(root, ".vercel-live-site");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(distDir, outDir, { recursive: true });
await cp(apiDir, join(outDir, "api"), { recursive: true });

async function removePythonFiles(target) {
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        await rm(fullPath, { recursive: true, force: true });
      } else {
        await removePythonFiles(fullPath);
      }
      continue;
    }
    if (entry.name.endsWith(".py") || entry.name.endsWith(".pyc")) {
      await rm(fullPath, { force: true });
    }
  }
}

await removePythonFiles(join(outDir, "api"));

await writeFile(
  join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "gorae-radar-live-site",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { build: "node -e \"console.log('static build ready')\"" },
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

await writeFile(
  join(outDir, "vercel.json"),
  JSON.stringify(
    {
      version: 2,
      buildCommand: "npm run build",
      outputDirectory: ".",
      cleanUrls: true,
      trailingSlash: false,
      rewrites: [
        ...appPages.map((page) => ({ source: `/${page.slug}`, destination: `/${page.slug}/index.html` })),
        ...contentPages.map((page) => ({ source: `/${page.slug}`, destination: `/${page.slug}/index.html` })),
      ],
      headers: [
        {
          source: "/static/js/(.*)",
          headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
        },
        {
          source: "/static/css/(.*)",
          headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
        },
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log("Built Vercel live site to .vercel-live-site/");
