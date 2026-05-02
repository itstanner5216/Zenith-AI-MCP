import { join, win32 } from "path";
import { platform } from "os";
import { copyFileSync, mkdirSync, existsSync } from "fs";
export class MCPConfigAdapter {
    backupDir;
    isSupported() {
        const plat = platform();
        const mapped = plat === "darwin" ? "macos" : plat === "win32" ? "windows" : "linux";
        return this.supportedPlatforms.includes(mapped);
    }
    backup(filePath) {
        if (!existsSync(filePath))
            return;
        const dir = this.backupDir ?? join(filePath, "..");
        const baseName = win32.basename(filePath);
        const name = this.backupDir
            ? `${this.toolName}_${baseName}.bak`
            : `${baseName}.bak`;
        mkdirSync(dir, { recursive: true });
        copyFileSync(filePath, join(dir, name));
    }
}
//# sourceMappingURL=base.js.map