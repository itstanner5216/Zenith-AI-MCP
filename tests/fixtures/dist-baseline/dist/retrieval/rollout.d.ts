import type { RetrievalConfig } from "./models.js";
export declare function isCanarySession(sessionId: string, canaryPercentage: number): boolean;
export declare function getSessionGroup(sessionId: string, config: RetrievalConfig): "canary" | "control";
