import path from "node:path";
import { promises as fs } from "node:fs";

export interface RollingLogOptions {
  maxBytes: number;
  retainBytes?: number;
}

const DEFAULT_RETAIN_RATIO = 0.75;

export async function appendLineToRollingLog(logPath: string, line: string, options: RollingLogOptions): Promise<void> {
  const normalizedLine = line.endsWith("\n") ? line : `${line}\n`;
  const retainBytes = normalizeRetainBytes(options.maxBytes, options.retainBytes);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await trimFileIfNeeded(logPath, options.maxBytes, retainBytes);
  await fs.appendFile(logPath, normalizedLine, "utf8");
  await trimFileIfNeeded(logPath, options.maxBytes, retainBytes);
}

function normalizeRetainBytes(maxBytes: number, retainBytes: number | undefined): number {
  if (Number.isInteger(retainBytes) && (retainBytes ?? 0) > 0 && (retainBytes ?? 0) < maxBytes) {
    return retainBytes as number;
  }
  return Math.max(1, Math.floor(maxBytes * DEFAULT_RETAIN_RATIO));
}

async function trimFileIfNeeded(logPath: string, maxBytes: number, retainBytes: number): Promise<void> {
  const stat = await safeStat(logPath);
  if (!stat || stat.size <= maxBytes) {
    return;
  }
  const bytes = await fs.readFile(logPath);
  if (bytes.length <= retainBytes) {
    return;
  }
  const retainedSlice = bytes.subarray(bytes.length - retainBytes);
  const newlineIndex = retainedSlice.indexOf(0x0a);
  const trimmed = newlineIndex >= 0 && newlineIndex + 1 < retainedSlice.length
    ? retainedSlice.subarray(newlineIndex + 1)
    : retainedSlice;
  await fs.writeFile(logPath, trimmed);
}

async function safeStat(targetPath: string) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return undefined;
  }
}