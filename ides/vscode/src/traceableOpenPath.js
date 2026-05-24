const path = require("node:path");

/**
 * @typedef {{ name: string, fsPath: string }} TraceableWorkspaceFolder
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeWorkspaceLookupValue(value) {
  return value.replace(/\\+/g, "/").replace(/^\.\//u, "").replace(/^\/+|\/+$/gu, "").toLowerCase();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeComparableWorkspacePath(value) {
  return path.resolve(value)
    .replace(/\\+/g, "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

/**
 * @param {string} targetPath
 * @param {TraceableWorkspaceFolder[]} workspaceFolders
 * @returns {boolean}
 */
function isPathWithinAnyWorkspaceRoot(targetPath, workspaceFolders) {
  const normalizedTarget = normalizeComparableWorkspacePath(targetPath);
  return workspaceFolders.some((folder) => {
    const normalizedRoot = normalizeComparableWorkspacePath(folder.fsPath);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
  });
}

/**
 * @param {string} name
 * @param {TraceableWorkspaceFolder[]} workspaceFolders
 * @returns {string | undefined}
 */
function getUniqueWorkspaceFolderMatchByName(name, workspaceFolders) {
  const normalizedName = normalizeWorkspaceLookupValue(name);
  if (!normalizedName) {
    return undefined;
  }
  const matches = workspaceFolders
    .filter((folder) => {
      const folderNames = new Set([
        normalizeWorkspaceLookupValue(folder.name),
        normalizeWorkspaceLookupValue(path.basename(folder.fsPath))
      ]);
      return folderNames.has(normalizedName);
    })
    .map((folder) => folder.fsPath);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * @param {string} targetPath
 * @param {TraceableWorkspaceFolder[]} workspaceFolders
 * @param {string} cwdRoot
 * @param {(filePath: string) => Promise<boolean>} pathExists
 * @param {string} [platform]
 * @returns {Promise<string | undefined>}
 */
async function resolveDriveLessAbsolutePathOnWindows(targetPath, workspaceFolders, cwdRoot, pathExists, platform = process.platform) {
  if (platform !== "win32" || !/^\/(?!\/)/u.test(targetPath)) {
    return undefined;
  }
  const rootedSuffix = targetPath.replace(/\//g, "\\");
  const driveRoots = new Set();
  for (const folder of workspaceFolders) {
    const parsedRoot = path.parse(folder.fsPath).root;
    if (parsedRoot) {
      driveRoots.add(parsedRoot.replace(/[\\/]+$/u, ""));
    }
  }
  if (cwdRoot) {
    driveRoots.add(cwdRoot.replace(/[\\/]+$/u, ""));
  }
  const candidates = [];
  for (const driveRoot of driveRoots) {
    const candidate = path.win32.normalize(`${driveRoot}${rootedSuffix}`);
    if (await pathExists(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * @param {string} targetPath
 * @param {TraceableWorkspaceFolder[]} workspaceFolders
 * @param {(filePath: string) => Promise<boolean>} pathExists
 * @returns {Promise<string | undefined>}
 */
async function resolveRelativeOpenPathInWorkspace(targetPath, workspaceFolders, pathExists) {
  const directCandidates = [];
  const workspaceRootCandidates = [];
  const normalizedTarget = normalizeWorkspaceLookupValue(targetPath);
  const [firstSegment, ...remainingSegments] = normalizedTarget.split("/").filter(Boolean);
  for (const folder of workspaceFolders) {
    const directCandidate = path.resolve(folder.fsPath, targetPath);
    if (await pathExists(directCandidate)) {
      directCandidates.push(directCandidate);
    }
    if (!firstSegment) {
      continue;
    }
    const folderNames = new Set([
      normalizeWorkspaceLookupValue(folder.name),
      normalizeWorkspaceLookupValue(path.basename(folder.fsPath))
    ]);
    if (!folderNames.has(firstSegment)) {
      continue;
    }
    const workspaceRootCandidate = remainingSegments.length > 0
      ? path.resolve(folder.fsPath, ...remainingSegments)
      : folder.fsPath;
    if (await pathExists(workspaceRootCandidate)) {
      workspaceRootCandidates.push(workspaceRootCandidate);
    }
  }
  if (directCandidates.length === 1) {
    return directCandidates[0];
  }
  if (directCandidates.length > 1) {
    throw new Error(`Relative open path ${JSON.stringify(targetPath)} matched multiple workspace paths. Use a more specific path.`);
  }
  if (workspaceRootCandidates.length === 1) {
    return workspaceRootCandidates[0];
  }
  if (workspaceRootCandidates.length > 1) {
    throw new Error(`Relative open path ${JSON.stringify(targetPath)} matched multiple workspace roots. Use a more specific path.`);
  }
  return undefined;
}

module.exports = {
  normalizeWorkspaceLookupValue,
  normalizeComparableWorkspacePath,
  isPathWithinAnyWorkspaceRoot,
  getUniqueWorkspaceFolderMatchByName,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace
};