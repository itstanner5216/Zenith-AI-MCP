/**
 * Zenith's local tool registry — tracks tools on the single Zenith server.
 * Extracted from tool_to_server dict pattern in mcp_proxy.py.
 *
 * HAZARD 1: Plain class, no MCP inheritance.
 * Handlers are stored but never invoked by this class.
 */
import { createHash } from "node:crypto";
export function makeToolKey(namespace, toolName) {
    return `${namespace}__${toolName}`;
}
export function hashToolList(tools) {
    const fps = tools
        .map((t) => [t.name, t.description ?? "", JSON.stringify(t.inputSchema ?? {})].join("|"))
        .sort();
    return createHash("sha256").update(fps.join(";;"), "utf-8").digest("hex").slice(0, 16);
}
export class ZenithToolRegistry {
    _m = new Map();
    register(tool, handler) {
        const key = makeToolKey("zenith", tool.name);
        const mapping = { serverName: "zenith", tool, handler };
        this._m.set(key, mapping);
        return mapping;
    }
    unregister(toolName) {
        return this._m.delete(makeToolKey("zenith", toolName));
    }
    get(toolKey) {
        return this._m.get(toolKey);
    }
    list() {
        return [...this._m.values()];
    }
    /** Shallow copy — callers can iterate without aliasing registry state. */
    asRecord() {
        const r = {};
        for (const [k, v] of this._m)
            r[k] = v;
        return r;
    }
    /** Live read-only view for consumers that must observe late registrations. */
    asLiveRecord() {
        const registry = this;
        return new Proxy({}, {
            ownKeys() {
                return [...registry._m.keys()];
            },
            getOwnPropertyDescriptor(_target, key) {
                return typeof key === "string" && registry._m.has(key)
                    ? { enumerable: true, configurable: true }
                    : undefined;
            },
            get(_target, key) {
                return typeof key === "string" ? registry._m.get(key) : undefined;
            },
            has(_target, key) {
                return typeof key === "string" && registry._m.has(key);
            },
        });
    }
    hash() {
        return hashToolList([...this._m.values()].map((m) => m.tool));
    }
}
//# sourceMappingURL=zenith-tool-registry.js.map