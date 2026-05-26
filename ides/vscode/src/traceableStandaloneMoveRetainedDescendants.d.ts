export type StandaloneMoveRetainedDescendant = {
  path: string;
  lineageLabel: string;
};

export type StandaloneMoveRetainedDescendantRewritePlan = {
  oldPath: string;
  newPath: string;
  oldLineageLabel: string;
  newLineageLabel: string;
  parentPathOverride: string;
};

export function planStandaloneMoveRetainedDescendantRewrites(input: {
  destinationPath: string;
  directChildren: readonly StandaloneMoveRetainedDescendant[];
}): StandaloneMoveRetainedDescendantRewritePlan[];