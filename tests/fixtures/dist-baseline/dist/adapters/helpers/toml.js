import { readFileSync, writeFileSync, existsSync } from "fs";
import TOML from "@iarna/toml";
export function readToml(path) {
    if (!existsSync(path)) {
        return {};
    }
    return TOML.parse(readFileSync(path, "utf-8"));
}
export function writeToml(path, data) {
    writeFileSync(path, TOML.stringify(data), "utf-8");
}
//# sourceMappingURL=toml.js.map