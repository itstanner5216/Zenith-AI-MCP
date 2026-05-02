import { readFileSync, writeFileSync, existsSync } from "fs";
import JSON5 from "json5";
export function readJson5(path) {
    if (!existsSync(path)) {
        return {};
    }
    return JSON5.parse(readFileSync(path, "utf-8"));
}
export function writeJson5(path, data) {
    writeFileSync(path, JSON5.stringify(data, null, 2) + "\n", "utf-8");
}
//# sourceMappingURL=json5.js.map