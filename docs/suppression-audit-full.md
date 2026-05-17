# Full Suppression Audit — `packages/zenith-mcp/src/`

> **Lens:** Every suppression is a symptom of a design issue. This document identifies the
> *structural* cause of each one and proposes the correct design — not the smallest patch,
> but what the code should look like when it's right.
>
> Items already covered in `type-correctness-improvements.md` are listed at the top.
> Everything else is documented in full below.

---

## Already Documented (see `type-correctness-improvements.md`)

| File | Issue | Correct design |
|---|---|---|
| `core/edit-engine.ts` | 12 `!` on mode fields | `validateEdit()` boundary layer → `ValidatedEdit` union |
| `core/edit-engine.ts` | ~10 array index `!` | `assertAt()` helper (required by `noUncheckedIndexedAccess`) |
| `tools/search_files.ts` | 8 `!` on `contentQuery`/`definesSymbol` | Local narrowed const after guard |
| `tools/refactor_batch.ts` | 3 `!` on `selection`, `cached`, `occList` | Guard + local narrowing |
| `core/path-utils.ts` | `normalizePath(p: any): any` | Overloads |
| `retrieval/pipeline.ts` | 6 `as unknown as` | Capability type guard functions |
| `retrieval/zenith-integration.ts` | 1 `as unknown as` | `getMcpServerInternals()` adapter |
| `core/symbol-index.ts` | 10 `// nosemgrep` | Not runtime — Semgrep CI tuning |
| `core/edit-engine.ts` | 5 `// nosemgrep` | Same |

---

## `core/compression.ts` — Wrong function signature on `isCompressionUseful`

```ts
// Current — both params typed as unknown, forces ! outside
export function isCompressionUseful(rawText: unknown, compressedText: unknown, ...): boolean

// Then at callsite:
const compressed = await runToonBridge(...);  // string | null
if (!isCompressionUseful(rawText, compressed, maxChars, keepRatio)) return null;
return { text: compressed!, compressedLength: compressed!.length };
```

**What's wrong:** `isCompressionUseful` takes `unknown` so it can handle `null` internally —
but that means the caller can't rely on it to narrow the type. The `!` outside is the symptom.

**The correct design:** `isCompressionUseful` should be a **type predicate** that simultaneously
checks and narrows `compressed`:

```ts
export function isCompressionUseful(
    rawText: string,
    compressed: string | null,
    maxChars: number,
    keepRatio?: number,
): compressed is string {
    if (compressed === null || compressed.length === 0 || rawText.length === 0) return false;
    // ... rest of logic using string operations directly — no typeof checks needed
}
```

With this signature, the callsite becomes:

```ts
const compressed = await runToonBridge(validPath, targetBudget);
if (!isCompressionUseful(rawText, compressed, maxChars, keepRatio)) return null;

// TypeScript knows compressed is string here — no ! anywhere
return {
    text: compressed,
    targetBudget,
    rawLength: rawText.length,
    compressedLength: compressed.length,
};
```

The `unknown` params on `isCompressionUseful` and `truncateToBudget` are also worth reviewing —
if these functions only ever receive strings (or strings + null), type them as such. `unknown` as
a defensive measure makes sense at API boundaries; inside a module it just weakens the types.

**Files:** `src/core/compression.ts`
**Suppressions eliminated:** 2 `!` + the `unknown` param weakening

---

## `tools/read_file.ts` — Implicit invariant not captured in types

```ts
if (!truncated && meta.hasMore && !args.compression) {
    metaHeader = `[offset=${args.offset! + meta.linesReturned!}]\n`;
}
```

**What's wrong:** `args.offset` and `meta.linesReturned` are typed as optional, but this branch
is only reached when the file has more content — at which point both values are always defined.
The types don't express that invariant, so `!` is used to bridge the gap.

**The correct design:** The invariant belongs in the type. If `meta.hasMore` is only ever `true`
when `linesReturned` is present, `ReadFileMeta` should express that:

```ts
interface ReadFileMetaBase {
    truncatedAt?: number;
    truncated: boolean;
}
interface ReadFileMetaWithMore extends ReadFileMetaBase {
    hasMore: true;
    linesReturned: number;   // required when hasMore is true
}
interface ReadFileMetaNoMore extends ReadFileMetaBase {
    hasMore: false;
    linesReturned?: never;
}
type ReadFileMeta = ReadFileMetaWithMore | ReadFileMetaNoMore;
```

Then `if (meta.hasMore)` narrows to `ReadFileMetaWithMore` and `meta.linesReturned` is `number`.
Similarly, if `args.offset` is always set when `hasMore` is true, that invariant belongs in the
args type or should be given a safe default of `0` (which is semantically correct — no offset
means start from line 0).

**Files:** `src/tools/read_file.ts` + wherever `ReadFileMeta` is defined
**Suppressions eliminated:** 2 `!`

---

## `retrieval/pipeline.ts:486` — Unnecessary `!` from incorrect variable type

```ts
const rankMap = new Map(scored.map((s, i) => [s.toolKey, i]));
// ...
const rank = rankMap.get(tk) ?? scored!.length;
```

**What's wrong:** `scored` has a type that includes `undefined` (or similar) even though by
the time `rankMap` is constructed from it, it's clearly defined. The `!` is papering over
a type that's too wide upstream.

**The correct design:** Find where `scored` is first assigned and narrow it there. If `scored`
can be absent before a certain point, use a proper control flow guard that TypeScript can track:

```ts
if (!scored) return; // or throw — explicit, TypeScript tracks this
const rankMap = new Map(scored.map((s, i) => [s.toolKey, i]));
// scored is ScoredTool[] from here — no ! needed anywhere below
const rank = rankMap.get(tk) ?? scored.length;
```

The rule: never assert `!` on a variable you already have a guard for. Move the guard up to where
it first becomes relevant, and the `!` disappears naturally.

**Files:** `src/retrieval/pipeline.ts`
**Suppressions eliminated:** 1 `!`

---

## `retrieval/ranking/bmx-index.ts` — Index class architecture with scattered invariants

```ts
// Pattern repeated 6 times across the class:
if (!this._postingListTFs.has(term)) this._postingListTFs.set(term, new Map());
this._postingListTFs.get(term)!.set(chunkId, count);   // has() + get() = pattern violation

if (!this._invertedIndex.has(term)) this._invertedIndex.set(term, new Set());
this._invertedIndex.get(term)!.add(chunkId);

const df = this._docFreqs.get(term)!;  // assumed initialized elsewhere
```

**What's wrong:** The `BMXIndex` class manages multiple parallel Maps (`_postingListTFs`,
`_invertedIndex`, `_docFreqs`, `_idfCache`, `_termEntropy`, `_termTotalFreqs`) that all
share the same key space and must be kept in sync. The invariant "a term always has entries
in all Maps" is currently enforced by convention (`has()` + `set()` at every callsite), which
is both verbose and leaky. The `!` assertions are the compiler complaining that it can't see
this invariant.

**The correct design:** Encapsulate the per-term data in a single object and manage all Maps
through a single `getOrCreateTerm()` accessor:

```ts
interface TermData {
    tf: Map<string, number>;   // chunkId → count
    docs: Set<string>;         // which chunks contain this term
    df: number;                // document frequency
    idf: number;               // cached IDF score
    totalFreq: number;
    entropy: number;
}

class BMXIndex {
    private _terms: Map<string, TermData> = new Map();
    private _documents: Map<string, string[]> = new Map();
    // ... other non-term fields

    private getOrCreateTerm(term: string): TermData {
        let data = this._terms.get(term);
        if (!data) {
            data = { tf: new Map(), docs: new Set(), df: 0, idf: 0, totalFreq: 0, entropy: 0 };
            this._terms.set(term, data);
        }
        return data;
    }

    private getTerm(term: string): TermData | undefined {
        return this._terms.get(term);
    }
}
```

Now instead of:
```ts
if (!this._postingListTFs.has(term)) this._postingListTFs.set(term, new Map());
this._postingListTFs.get(term)!.set(chunkId, count);
if (!this._invertedIndex.has(term)) this._invertedIndex.set(term, new Set());
this._invertedIndex.get(term)!.add(chunkId);
```

It becomes:
```ts
const td = this.getOrCreateTerm(term);
td.tf.set(chunkId, count);
td.docs.add(chunkId);
```

Zero `!` assertions. The invariant is structural — `TermData` always has all fields — rather than
enforced by convention at scattered callsites. The class also becomes significantly more readable.

**Files:** `src/retrieval/ranking/bmx-index.ts`
**Suppressions eliminated:** 6 `!` (plus likely reduces overall complexity significantly)

---

## `retrieval/ranking/fusion.ts` — Map.get() on known key

```ts
toolMapping: toolMap.get(key)!,
```

Same pattern as `bmx-index.ts`. If `key` comes from iterating `toolMap.keys()` or another
guaranteed-present source, that invariant should be visible to TypeScript. Either iterate
the Map entries directly (`.entries()` gives `[K, V]` not `[K, V | undefined]`) or use the
same `mapGet` helper approach:

```ts
// Instead of iterating keys then getting:
for (const key of toolMap.keys()) {
    const mapping = toolMap.get(key)!;  // !
}

// Iterate entries — key and value always paired:
for (const [key, mapping] of toolMap.entries()) {
    // mapping is V, not V | undefined — no ! needed
}
```

**Files:** `src/retrieval/ranking/fusion.ts`
**Suppressions eliminated:** 1 `!`

---

## `retrieval/telemetry/tokens.ts` — Wrong API for "get filename from path"

```ts
// Repeated 5 times:
const basename = filepath.split("/").pop()!;
```

**What's wrong:** `.split().pop()` returns `string | undefined` — the `!` is used because
the developer knows a non-empty string split always has at least one element. But more
fundamentally, this is the wrong API for extracting a filename. It only works on Unix-style
paths with forward slashes; `path.posix.basename()` is the correct, semantically named,
always-returns-string operation.

**The correct design:**

```ts
import { posix } from 'path';

// All 5 callsites:
const basename = posix.basename(filepath);  // string, no !, works on any path format
```

`posix.basename()` handles edge cases (trailing slashes, root paths) correctly and always
returns `string`. The intent is also clear from the name.

**Files:** `src/retrieval/telemetry/tokens.ts`
**Suppressions eliminated:** 5 `!`

---

## `utils/project-scope.ts` — Cache design with false `undefined` possibility

```ts
if (!options?.noCache && _cache.has(absPath)) {
    return _cache.get(absPath)!;  // has() proves it exists, but get() returns T | undefined
}
```

**What's wrong:** This is the classic `Map.has()` + `Map.get()` problem — TypeScript can't
narrow `get()` through `has()` across statements. The `!` is technically correct but the
design is fragile.

**The correct design:** Use a single `get()` and check the result:

```ts
if (!options?.noCache) {
    const cached = _cache.get(absPath);
    if (cached !== undefined) return cached;
    // Note: cached can be null (intentionally stored as "no project found")
    // If _cache.has() but .get() returned undefined, that's a Map invariant violation
    if (_cache.has(absPath)) return null;  // explicitly stored null = "resolved, no project"
}
```

But actually the deeper issue is that `_cache` stores `string | null` — `null` meaning "resolved
to no project." The `has()` check is necessary to distinguish "not cached" from "cached as null."
A cleaner encoding uses a sentinel or a `Result` type:

```ts
const NOT_CACHED = Symbol('NOT_CACHED');
const _cache = new Map<string, string | null | typeof NOT_CACHED>();

// Lookup:
const cached = _cache.get(absPath) ?? NOT_CACHED;
if (cached !== NOT_CACHED) return cached;  // string | null, no !

// Set:
_cache.set(absPath, result);  // string | null
```

No `has()` + `get()` split. No `!`. The sentinel makes the "not yet resolved" state explicit
in the type rather than relying on Map presence semantics.

**Files:** `src/utils/project-scope.ts`
**Suppressions eliminated:** 1 `!`, plus makes the "null = resolved to nothing" intent explicit

---

## `adapters/platforms/*.ts` — Architecture: write methods on a nullable-path type

```ts
// base.ts
abstract configPath(): string | null;
abstract writeConfig(data: Record<string, unknown>): void;

// Every concrete platform — 14 files:
writeConfig(data: Record<string, unknown>) {
    const p = this.configPath()!;  // crash if platform not installed
    ...
}
```

**What's wrong:** The base class declares `configPath(): string | null` — correctly reflecting
that a platform might not be installed. But `writeConfig` and `registerServer` are abstract
methods that don't account for this — they're forced to `!` because they have no way to
return an error from a `void` method.

The root design question: *should it be possible to call `writeConfig()` on an unsupported
platform?* Almost certainly not. But right now, nothing stops it.

**The correct design — make unavailability architectural, not a runtime crash:**

Option A (recommended): Add `isSupported()` to the abstract contract and make the base class
enforce it before delegating:

```ts
// base.ts
abstract configPath(): string | null;

// Non-abstract — enforces the invariant for all subclasses:
writeConfig(data: Record<string, unknown>): void {
    const p = this.configPath();
    if (!p) throw new Error(`${this.displayName} is not available on this platform`);
    this.writeConfigToPath(p, data);
}

protected abstract writeConfigToPath(configPath: string, data: Record<string, unknown>): void;
```

Now subclasses implement `writeConfigToPath(p: string, ...)` — `p` is always `string`, no `!`
anywhere. The availability check lives in one place (the base class). Adding a new platform
adapter is simpler and can't accidentally skip the guard.

Option B: Split the type hierarchy — have a checked `getAdapter()` factory that returns
`MCPConfigAdapter | null`, where a non-null adapter is *guaranteed* to have a config path:

```ts
// factory
function getAdapter(toolName: string): MCPConfigAdapter | null {
    const adapter = registry.get(toolName);
    if (!adapter?.isSupported() || !adapter.configPath()) return null;
    return adapter;
}
// callers only get non-null adapters when the platform is actually available
```

Either option eliminates the `!` in all 14 platform files by making the guard architectural.

**Files:** `src/adapters/base.ts` + all 14 `src/adapters/platforms/*.ts`
**Suppressions eliminated:** 14+ `!` across all platform adapters

---

## `adapters/platforms/claude-desktop.ts`, `jetbrains.ts`, others — `Record<string, any>`

```ts
// Implementations override the base class contract:
writeConfig(data: Record<string, any>): void   // weakens Record<string, unknown>
registerServer(name: string, config: Record<string, any>): void

// Internal usage:
const result: Record<string, Record<string, any>> = (this.readConfig().mcpServers || {}) as Record<string, Record<string, any>>;
```

**What's wrong:** `Record<string, any>` opts out of type checking entirely for the values.
`Record<string, unknown>` (the base class contract) is the correct type for "arbitrary JSON
object" — it requires callers to narrow values before using them, rather than silently accepting
any operation.

The internal cast to `Record<string, Record<string, any>>` compounds this — the `any` spreads
to every value access.

**The correct design:** Each platform adapter should have a typed config interface:

```ts
// claude-desktop.ts
interface McpServerEntry {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    [key: string]: unknown;  // extensible but typed at known fields
}

interface ClaudeDesktopConfig {
    mcpServers?: Record<string, McpServerEntry>;
    [key: string]: unknown;
}
```

Then `readConfig(): ClaudeDesktopConfig`, `writeConfig(data: ClaudeDesktopConfig)`, etc.
No `any`, no casts at internal access points — the data shape is just declared.

This is more work but is the correct level of typing for config files where the schema is
well-known. At minimum, replace `any` with `unknown` everywhere and use type guards at the
specific points where values are read.

**Files:** Multiple `src/adapters/platforms/*.ts`
**Suppressions eliminated:** Multiple `Record<string, any>` weakening the type contract

---

## `retrieval/zenith-integration.ts` — Zod/schema interop casts

```ts
const obj = normalizeObjectSchema(schema as Parameters<typeof normalizeObjectSchema>[0]);
const result = toJsonSchemaCompat(schema as Parameters<typeof toJsonSchemaCompat>[0], {...}) as Tool["inputSchema"];
```

**What's wrong:** The helpers `normalizeObjectSchema` and `toJsonSchemaCompat` have parameter
types that are too narrow for what's being passed. The `as Parameters<typeof fn>[0]` cast is
particularly telling — it means "I know the parameter type of this function, and I'm forcing
my value into it." That's a sign the function's parameter type should be widened, not that the
caller should cast.

**The correct design:** Widen the helper signatures to accept `ZodTypeAny` or `z.ZodSchema`
at the input boundary, and let them narrow internally if needed:

```ts
// Instead of:
function normalizeObjectSchema(schema: ZodObject<...>): ...
// Use:
function normalizeObjectSchema(schema: z.ZodTypeAny): ...
// Or if only ZodObject is valid, add a runtime check inside and throw a clear error
```

Then callers don't need to cast — TypeScript already knows `schema` is a Zod schema.

**Files:** `src/retrieval/zenith-integration.ts`
**Suppressions eliminated:** 2 `as` casts

---

## `retrieval/ranking/bmx-index.ts:452` — Dynamic field access on typed object

```ts
const text = (doc as unknown as Record<string, unknown>)[fieldName] as string | undefined ?? "";
```

**What's wrong:** `doc` has a concrete type but is being accessed by a dynamic `fieldName`.
This suggests `doc` is a struct but `fieldName` is determined at runtime — a mismatch.

**The correct design:** If the set of valid field names is known at compile time, use a type-safe
accessor:

```ts
type DocFieldName = 'title' | 'content' | 'summary';  // or whatever the actual fields are

function getDocField(doc: BmxDocument, field: DocFieldName): string {
    return doc[field] ?? '';  // TypeScript knows doc[field] is string | undefined
}
```

If `fieldName` is truly dynamic (user-provided, from config, etc.), then `doc` should be typed
as `Record<string, string | undefined>` at that point — and the cast happens once at the model
boundary, not at every field access.

**Files:** `src/retrieval/ranking/bmx-index.ts`
**Suppressions eliminated:** 1 `as unknown as` → typed accessor

---

## Complete Summary

| File | Suppressions | Design fix |
|---|---|---|
| `core/compression.ts` | 2 `!` + `unknown` params | `isCompressionUseful` as type predicate |
| `tools/read_file.ts` | 2 `!` | Discriminated `ReadFileMeta` type |
| `retrieval/pipeline.ts` (new) | 1 `!` | Move guard up; `scored` is non-null from there |
| `retrieval/ranking/bmx-index.ts` | 6 `!` + 1 `as unknown as` | `TermData` class, `getOrCreateTerm()` |
| `retrieval/ranking/fusion.ts` | 1 `!` | Iterate `.entries()` instead of `.keys()` + get |
| `retrieval/telemetry/tokens.ts` | 5 `!` | `posix.basename()` — correct API for the job |
| `utils/project-scope.ts` | 1 `!` | Symbol sentinel for "not cached" state |
| `adapters/base.ts` + 14 platforms | 14+ `!` | `writeConfigToPath(p: string)` pattern in base |
| `adapters/` config types | multiple `any` | Per-platform config interfaces |
| `retrieval/zenith-integration.ts` | 2 `as` casts | Widen helper param types |
| `retrieval/ranking/bmx-index.ts` | 1 `as unknown as` | Typed accessor function |
