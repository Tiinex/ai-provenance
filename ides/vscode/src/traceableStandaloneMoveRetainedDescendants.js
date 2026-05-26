import path from "node:path";

export function planStandaloneMoveRetainedDescendantRewrites(input) {
  const destinationPath = path.resolve(input.destinationPath);
  return [...input.directChildren]
    .sort((left, right) => left.lineageLabel.localeCompare(right.lineageLabel))
    .map((child) => ({
      oldPath: path.resolve(child.path),
      newPath: path.resolve(child.path),
      oldLineageLabel: child.lineageLabel,
      newLineageLabel: child.lineageLabel,
      parentPathOverride: destinationPath
    }));
}