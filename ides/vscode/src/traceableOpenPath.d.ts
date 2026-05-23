export interface TraceableOpenWorkspaceFolder {
  name: string;
  fsPath: string;
}

export function normalizeWorkspaceLookupValue(value: string): string;
export function normalizeComparableWorkspacePath(value: string): string;
export function isPathWithinAnyWorkspaceRoot(targetPath: string, workspaceFolders: TraceableOpenWorkspaceFolder[]): boolean;
export function getUniqueWorkspaceFolderMatchByName(name: string, workspaceFolders: TraceableOpenWorkspaceFolder[]): string | undefined;
export function resolveDriveLessAbsolutePathOnWindows(
  targetPath: string,
  workspaceFolders: TraceableOpenWorkspaceFolder[],
  cwdRoot: string,
  pathExists: (filePath: string) => Promise<boolean>,
  platform?: string
): Promise<string | undefined>;
export function resolveRelativeOpenPathInWorkspace(
  targetPath: string,
  workspaceFolders: TraceableOpenWorkspaceFolder[],
  pathExists: (filePath: string) => Promise<boolean>
): Promise<string | undefined>;