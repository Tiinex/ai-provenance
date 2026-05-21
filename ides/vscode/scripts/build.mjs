import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const distDir = path.join(packageRoot, "dist");
const watchMode = process.argv.includes("--watch");

function createOptions() {
  return {
    entryPoints: [path.join(packageRoot, "src", "extension.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: path.join(distDir, "extension.js"),
    external: ["vscode"],
    sourcemap: true,
    logLevel: "info"
  };
}

if (watchMode) {
  const context = await esbuild.context(createOptions());
  await context.watch();
  await context.rebuild();
  console.log("Watching bundled VS Code extension build...");
} else {
  await esbuild.build(createOptions());
}