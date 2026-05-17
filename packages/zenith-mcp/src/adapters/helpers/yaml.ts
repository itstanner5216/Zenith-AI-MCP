import { readFileSync, writeFileSync, existsSync } from "fs";
import YAML from "js-yaml";

export function readYaml(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  const parsed = YAML.load(readFileSync(path, "utf-8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function writeYaml(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, YAML.dump(data), "utf-8");
}
