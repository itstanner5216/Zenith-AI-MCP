import { readFileSync, writeFileSync, existsSync } from "fs";
import YAML from "js-yaml";
export function readYaml(path) {
    if (!existsSync(path)) {
        return {};
    }
    return YAML.load(readFileSync(path, "utf-8"));
}
export function writeYaml(path, data) {
    writeFileSync(path, YAML.dump(data), "utf-8");
}
//# sourceMappingURL=yaml.js.map