import * as vscode from "vscode";
import type { TraceablePreparedRenameMove } from "./traceableFileOperations";

export type TraceableMoveFileMutation = {
  kind: "move-file";
} & TraceablePreparedRenameMove;

export type TraceableCopyFileMutation = {
  kind: "copy-file";
} & TraceablePreparedRenameMove;

export type TraceableRewriteFileMutation = {
  kind: "rewrite-file";
  fileUri: vscode.Uri;
  nextContent: string;
};

export type TraceableMutationPlanMutation =
  | TraceableMoveFileMutation
  | TraceableCopyFileMutation
  | TraceableRewriteFileMutation;

export interface TraceableMutationPlan {
  mutations: readonly TraceableMutationPlanMutation[];
  blocked: boolean;
}

export interface PreparedTraceableMutationPlan {
  plan: TraceableMutationPlan;
  outputPaths: string[];
}

export function createTraceableMoveMutation(move: TraceablePreparedRenameMove): TraceableMoveFileMutation {
  return {
    kind: "move-file",
    oldUri: move.oldUri,
    newUri: move.newUri,
    rewrittenMarkdown: move.rewrittenMarkdown
  };
}

export function createTraceableCopyMutation(move: TraceablePreparedRenameMove): TraceableCopyFileMutation {
  return {
    kind: "copy-file",
    oldUri: move.oldUri,
    newUri: move.newUri,
    rewrittenMarkdown: move.rewrittenMarkdown
  };
}

export function createTraceableRewriteMutation(fileUri: vscode.Uri, nextContent: string): TraceableRewriteFileMutation {
  return {
    kind: "rewrite-file",
    fileUri,
    nextContent
  };
}
