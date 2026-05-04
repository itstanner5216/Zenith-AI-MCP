import type { RootEvidence, WorkspaceEvidence } from "../models.js";
export type { RootEvidence, WorkspaceEvidence } from "../models.js";
export declare function mergeEvidence(roots: RootEvidence[]): WorkspaceEvidence;
export declare function fingerprintEvidence(foundFiles: string[]): string;
