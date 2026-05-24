import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const probeRoot = path.join(repoRoot, "assets", "sender-adaptation-probes");

async function readProbeMarkdown(fileName) {
  const filePath = path.join(probeRoot, fileName);
  return readFile(filePath, "utf8");
}

async function verifyObservedProbe() {
  const markdown = await readProbeMarkdown("05-anchor.trace.md");
  assert.ok(markdown.includes("## Sender Adaptation State"), "Observed probe is missing the sender adaptation section.");
  assert.ok(markdown.includes("baselineExplanation=minimal [observed]"), "Observed probe should record baselineExplanation=minimal as observed.");
  assert.ok(markdown.includes("responseCompression=concise [observed]"), "Observed probe should record responseCompression=concise as observed.");
  assert.ok(markdown.includes("tradeoffStyle=explicit [observed]"), "Observed probe should record tradeoffStyle=explicit as observed.");
}

async function verifyReinforcedProbe() {
  const markdown = await readProbeMarkdown("05-02-anchor.trace.md");
  assert.ok(markdown.includes("baselineExplanation=minimal [reinforced x2]"), "Reinforced probe should elevate baselineExplanation=minimal to reinforced x2.");
  assert.ok(markdown.includes("responseCompression=concise [reinforced x2]"), "Reinforced probe should elevate responseCompression=concise to reinforced x2.");
  assert.ok(markdown.includes("tradeoffStyle=explicit [reinforced x2]"), "Reinforced probe should elevate tradeoffStyle=explicit to reinforced x2.");
}

async function verifyWeakenedProbe() {
  const markdown = await readProbeMarkdown("05-07-anchor.trace.md");
  assert.ok(markdown.includes("baselineExplanation=extra [observed]"), "Weakened probe should record the new baselineExplanation=extra observation.");
  assert.ok(markdown.includes("baselineExplanation=minimal [weakened]"), "Weakened probe should mark the older baselineExplanation=minimal claim as weakened.");
  assert.ok(markdown.includes("responseCompression=expanded [observed]"), "Weakened probe should record the new responseCompression=expanded observation.");
  assert.ok(markdown.includes("responseCompression=concise [weakened]"), "Weakened probe should mark the older responseCompression=concise claim as weakened.");
  assert.ok(markdown.includes("tradeoffStyle=implicit [observed]"), "Weakened probe should record the new tradeoffStyle=implicit observation.");
  assert.ok(markdown.includes("tradeoffStyle=explicit [weakened]"), "Weakened probe should mark the older tradeoffStyle=explicit claim as weakened.");
}

async function main() {
  await verifyObservedProbe();
  await verifyReinforcedProbe();
  await verifyWeakenedProbe();
  console.log("sender adaptation probe checks passed");
}

await main();