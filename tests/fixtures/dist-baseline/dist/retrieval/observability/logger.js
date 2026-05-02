import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export class NullRetrievalLogger {
    async log(_event) { }
    async logRetrieval(_context, _results, _latencyMs) { }
    async logRetrievalMiss(_toolName, _context) { }
    async logToolSequence(_sessionId, _toolA, _toolB) { }
    async logAlert(_alertName, _message, _details) { }
}
export class FileRetrievalLogger {
    _path;
    constructor(logPath) {
        this._path = logPath;
        // Ensure parent directory exists
        mkdir(dirname(logPath), { recursive: true }).catch(() => { });
    }
    async log(event) {
        const line = JSON.stringify(event, (_, v) => typeof v === "bigint" ? v.toString() : v);
        try {
            await appendFile(this._path, line + "\n", "utf-8");
        }
        catch (err) {
            console.error("FileRetrievalLogger.write error:", err);
        }
    }
    async logAlert(alertName, message, details) {
        const record = {
            type: "alert",
            alertName,
            message,
            details: details ?? {},
            timestamp: Date.now() / 1000,
        };
        try {
            await appendFile(this._path, JSON.stringify(record, (_, v) => typeof v === "bigint" ? v.toString() : v) + "\n", "utf-8");
        }
        catch (err) {
            console.error("FileRetrievalLogger.logAlert write error:", err);
        }
    }
}
//# sourceMappingURL=logger.js.map