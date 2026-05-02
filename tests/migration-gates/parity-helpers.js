import fs from 'fs/promises';
import fssync from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const ROOT = process.cwd();
export const BASELINE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'dist-baseline', 'dist');
export const DIST_ROOT = path.join(ROOT, 'dist');

let importCounter = 0;
export async function importByPath(absPath) {
  return import(`${pathToFileURL(absPath).href}?migrationGate=${Date.now()}-${importCounter++}`);
}

export function baselinePath(...parts) {
  return path.join(BASELINE_ROOT, ...parts);
}

export function rebuiltPath(...parts) {
  return path.join(DIST_ROOT, ...parts);
}

export async function importPair(...parts) {
  const baseline = baselinePath(...parts);
  const rebuilt = rebuiltPath(...parts);
  return {
    baselinePath: baseline,
    rebuiltPath: rebuilt,
    baseline: await importByPath(baseline),
    rebuilt: await importByPath(rebuilt),
  };
}

export function exportedKeys(mod) {
  return Object.keys(mod).sort();
}

export async function expectSameResult(fnA, fnB, ...args) {
  const settle = async (fn) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: normalizeError(error) };
    }
  };
  return [await settle(fnA), await settle(fnB)];
}

export function normalizeError(error) {
  return {
    name: error?.name,
    message: error?.message ?? String(error),
    code: error?.code,
  };
}

export function normalizeText(value, replacements = []) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  // Normalize temp suffixes and Windows separators if any leak in.
  return text.replace(/[A-Za-z]:\\\\/g, '/').replace(/\\\\/g, '/');
}

export function captureServer() {
  const calls = [];
  return {
    calls,
    server: {
      registerTool(name, schema, handler) {
        calls.push({ name, schema, handler });
      }
    }
  };
}

export function schemaSummary(schema) {
  const seen = new WeakSet();
  const clean = (value) => {
    if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    // Zod schema: zod-to-json-schema provides a stable semantic summary. Keep
    // description/default-ish metadata when available so verbose schema drift fails.
    if (value._def || value.def || typeof value.safeParse === 'function') {
      try {
        return { zodJsonSchema: zodToJsonSchema(value) };
      } catch {
        return {
          zodTypeName: value._def?.typeName ?? value.def?.type,
          description: value.description,
          isOptional: typeof value.isOptional === 'function' ? value.isOptional() : undefined,
        };
      }
    }

    if (Array.isArray(value)) return value.map(clean);
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = clean(value[key]);
    }
    return out;
  };
  return clean(schema);
}

export function toolRegistrationSummary(calls) {
  return calls.map(({ name, schema }) => ({
    name,
    title: schema?.title,
    description: schema?.description,
    annotations: schema?.annotations,
    inputSchema: schemaSummary(schema?.inputSchema),
  }));
}

export async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function copyDir(src, dest) {
  await fs.cp(src, dest, { recursive: true });
}

export function makeCtx(root, extra = {}) {
  const roots = [root];
  return {
    sessionId: extra.sessionId || `migration-gate-${process.pid}`,
    async validatePath(inputPath = root) {
      const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath);
      const resolved = path.resolve(candidate);
      const ok = roots.some(r => resolved === path.resolve(r) || resolved.startsWith(path.resolve(r) + path.sep));
      if (!ok) throw new Error(`Access denied: ${inputPath}`);
      return resolved;
    },
    getAllowedDirectories() { return [...roots]; },
    setAllowedDirectories(next) { roots.splice(0, roots.length, ...next); },
    ...extra,
  };
}

export async function makeSampleProject(root) {
  await fs.mkdir(path.join(root, 'sub'), { recursive: true });
  await fs.writeFile(path.join(root, 'alpha.txt'), 'one\ntwo\nneedle\nfour\nfive\n', 'utf8');
  await fs.writeFile(path.join(root, 'beta.txt'), 'beta first\nneedle beta\nlast\n', 'utf8');
  await fs.writeFile(path.join(root, 'sub', 'gamma.js'), 'export function add(a, b) {\n  return a + b;\n}\n\nexport class Box {\n  value() { return 1; }\n}\n', 'utf8');
  await fs.writeFile(path.join(root, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2, 3]));
}

export async function runToolInTwinDirs(modulePathParts, args, options = {}) {
  const { baseline, rebuilt } = await importPair(...modulePathParts);
  return withTempDir('zenith-migration-tool-', async (parent) => {
    const baseRoot = path.join(parent, 'baseline');
    const rebuiltRoot = path.join(parent, 'rebuilt');
    await fs.mkdir(baseRoot, { recursive: true });
    await makeSampleProject(baseRoot);
    await copyDir(baseRoot, rebuiltRoot);

    if (options.beforeEach) {
      await options.beforeEach(baseRoot, 'baseline');
      await options.beforeEach(rebuiltRoot, 'rebuilt');
    }

    const baseCapture = captureServer();
    const rebuiltCapture = captureServer();
    baseline.register(baseCapture.server, makeCtx(baseRoot, options.ctxExtra?.baseline || {}));
    rebuilt.register(rebuiltCapture.server, makeCtx(rebuiltRoot, options.ctxExtra?.rebuilt || {}));
    const baseCall = baseCapture.calls[options.callIndex || 0];
    const rebuiltCall = rebuiltCapture.calls[options.callIndex || 0];

    const settle = async (call, root) => {
      try {
        return { ok: true, value: await call.handler(args), root };
      } catch (error) {
        return { ok: false, error: normalizeError(error), root };
      }
    };

    const baseResult = await settle(baseCall, baseRoot);
    const rebuiltResult = await settle(rebuiltCall, rebuiltRoot);
    return { baseResult, rebuiltResult, baseRoot, rebuiltRoot };
  });
}

export async function readIfExists(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

export function fileExists(file) {
  return fssync.existsSync(file);
}
