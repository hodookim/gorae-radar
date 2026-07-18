import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = join(process.cwd(), "dist");
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.name.endsWith(".html")) htmlFiles.push(fullPath);
  }
}

await walk(root);
const errors = [];
const allowedRootFiles = new Set([
  "/ads.txt",
  "/robots.txt",
  "/sitemap.xml",
  "/rss.xml",
  "/naver0e7986cc8358bf3048efb564b27a8c87.html",
  "/favicon.ico",
]);
for (const path of allowedRootFiles) {
  if (path === "/favicon.ico") continue;
  if (!existsSync(join(root, path.slice(1)))) errors.push(`missing root file ${path}`);
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const label = relative(root, file).split(sep).join("/");
  const isNotFound = label === "404.html";
  const isVerification = label === "naver0e7986cc8358bf3048efb564b27a8c87.html";
  const visibleDocument = html.replace(/<template\b[\s\S]*?<\/template>/g, "");
  if (!isNotFound && !isVerification) {
    if ((visibleDocument.match(/<h1\b/g) || []).length !== 1) errors.push(`${label}: expected one visible h1`);
    if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${label}: missing title`);
    if (!/<meta name="description"/.test(html)) errors.push(`${label}: missing description`);
    if (!/<meta name="google-adsense-account"/.test(html)) errors.push(`${label}: missing AdSense ownership meta`);
  }

  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      errors.push(`${label}: invalid JSON-LD (${error.message})`);
    }
  }

  for (const match of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const urlPath = match[1];
    if (urlPath === "/" || urlPath.startsWith("/static/") || allowedRootFiles.has(urlPath)) continue;
    const directTarget = join(root, ...urlPath.split("/").filter(Boolean));
    if (existsSync(directTarget)) continue;
    const target = join(root, ...urlPath.split("/").filter(Boolean), "index.html");
    if (!existsSync(target)) errors.push(`${label}: broken internal link ${urlPath}`);
  }
}

const aadsFiles = [];
const adsenseScriptFiles = [];
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (/a-ads|acceptable\.a-ads|data-aa/.test(html)) aadsFiles.push(relative(root, file));
  if (html.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js")) {
    adsenseScriptFiles.push(relative(root, file));
  }
}

if (aadsFiles.length) errors.push(`AADS remains in: ${aadsFiles.join(", ")}`);
if (adsenseScriptFiles.length !== 1 || adsenseScriptFiles[0] !== "index.html") {
  errors.push(`AdSense review script scope is unexpected: ${adsenseScriptFiles.join(", ") || "none"}`);
}

console.log(`HTML files: ${htmlFiles.length}`);
console.log(`AdSense script files: ${adsenseScriptFiles.join(", ")}`);
console.log(`AADS files: ${aadsFiles.length}`);
console.log(`Errors: ${errors.length}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
