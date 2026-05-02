import type { ToolCatalogSnapshot } from "./models.js";
import type { ToolMapping } from "./models.js";
export declare function buildSnapshot(registry: Record<string, ToolMapping>): ToolCatalogSnapshot;
