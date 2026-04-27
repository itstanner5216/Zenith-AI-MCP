# Zenith-MCP Codebase Review

**Reviewer:** Senior Principal Code Review Agent  
**Date:** 2026-04-27  
**Scope:** Full repository (`src/`, `dist/`, `tests/`, configuration, docs)  
**Lines Reviewed:** ~6,500 (all `dist/core/`, `dist/tools/`, `dist/server/`, `dist/cli/`, `src/adapters/`, `src/config/`, `src/retrieval/`, and 21 test files)

---

## Code Review Summary

**Verdict:** REQUEST CHANGES  
**Complexity Score:** 7/10

The codebase exhibits a hybrid architecture with hand-authored JavaScript in `dist/` and TypeScript in `src/`. Core security primitives (path validation, atomic writes, timing-safe token comparison) are well-implemented in isolation, but systemic issues undermine correctness and maintainability: duplicate path-normalization logic, a process-level singleton that breaks HTTP multi-session isolation, hardcoded platform-specific paths, unvalidated user-controlled regular expressions, and several documented bugs confirmed by tests. The most complex tool (`refactor_batch.js`) exceeds 1,000 lines with a brittle custom payload parser. The project is also **unbuildable from source** because TypeScript sources for `core/`, `tools/`, `cli/`, and `server/` are missing from the repository.

---

## 🚨 Critical Findings (Security, Data Loss, Build Breakers)

### 1. Unvalidated User-Controlled Regular Expression (ReDoS)
* **[File:Line]** - `dist/tools/search_files.js:532` — **Security**
* When `args.literalSearch` is `false`, the tool passes `args.contentQuery` directly into `new RegExp(args.contentQuery, 'gi')` without validation or timeout. A malicious or accidentally pathological pattern (e.g., `(a+)+$`) can cause catastrophic backtracking, blocking the event loop and denying service to all concurrent sessions.
  * **Remediation:** Always construct the regex inside a `try/catch`, limit pattern length, and when `literalSearch` is disabled, pre-validate with a whitelist or run the search with a timeout. Prefer moving regex execution to a worker thread or `vm` with a time limit.

### 2. Hardcoded Developer Machine Path in Production Bridge
* **[File:Line]** - `dist/core/toon_bridge.js:44` — **Security / Portability**
* The compression bridge falls back to `/home/tanner/Projects/toon`, a developer-specific absolute path leaked into version-controlled production code. This causes a hard failure on any machine except the original developer's.
  * **Remediation:** Remove the hardcoded fallback. Require `TOON_PROJECT_DIR` to be set explicitly, and throw a clear error at startup if it is missing.

### 3. Hardcoded Ripgrep Path Breaks Portability
* **[File:Line]** - `dist/core/shared.js:351` — **Build Breaker / Portability**
* `const RG_PATH = '/usr/bin/rg'` fails on macOS (typically `/opt/homebrew/bin/rg`), NixOS, and many Linux distributions. The `ripgrepAvailable()` check only verifies executability at that exact path, so the server silently falls back to the much slower pure-JS search on all non-Debian systems.
  * **Remediation:** Resolve `rg` from `PATH` using `which rg` or `command -v rg` at startup, cache the result, and only fall back to the hardcoded path as a last resort.

---

## ⚠️ High Findings (Logic Errors, Major Performance Bottlenecks)

### 1. Global-Flag Regex Mutates `lastIndex` in Loop, Causing Skipped Matches
* **[File:Line]** - `dist/tools/search_files.js:529,621` — **Correctness**
* The content-search regex is constructed with flags `'gi'`. Inside the JS fallback loop, `contentRegex.test(lines[i])` is called repeatedly. Because of the `g` flag, a successful match advances `lastIndex`; on the next iteration, if the next line is shorter than `lastIndex`, `test()` returns `false` and resets `lastIndex`, causing sporadically skipped matches.
  * **Remediation:** Remove the `g` flag (`flags = 'i'`). The global flag is unnecessary when testing individual lines.

### 2. Two Conflicting `normalizePath()` Implementations
* **[File:Line]** - `dist/core/path-utils.js:34` and `dist/core/path-validation.js:11` — **Correctness / Maintainability**
* `path-utils.js` exports a Windows/WSL-aware normalization that strips quotes but does **not** reject null bytes and does **not** expand `~`. `path-validation.js` exports a simpler Unix-focused normalization that **does** reject null bytes, expand `~`, and uses an LRU cache. `lib.js` imports from both modules, creating a situation where the path validated by one normalizer is checked against allowed directories using a different normalizer. Divergent behavior for edge-case inputs (null bytes, trailing slashes, Windows paths) is likely.
  * **Remediation:** Consolidate to a single `normalizePath` implementation. Move null-byte rejection, home expansion, and caching into the unified function, and keep the Windows/WSL logic as a separate `toPlatformPath` helper if needed.

### 3. `ProjectContext` Singleton Leaks State Across HTTP Sessions
* **[File:Line]** - `dist/core/project-context.js:248-255` — **Security / Correctness**
* `getProjectContext(ctx)` uses a module-level `_instance` singleton. In HTTP mode, each session receives its own `FilesystemContext`, but they all share the same `ProjectContext`. This means session A's project root, stash DB, and registered roots can influence session B's behavior. `_resolveFromRegistry()` at line 220 further compounds this by using `cwd.startsWith(row.root_path)`, which is vulnerable to prefix matching (`/foo` matches `/foobar`).
  * **Remediation:** Remove the singleton. Instantiate `ProjectContext` per `FilesystemContext` (or per session) and store it on the context object itself. Fix the prefix match by appending a path separator: `cwd.startsWith(row.root_path + path.sep)`.

### 4. Synchronous `git` Execution Blocks Event Loop
* **[File:Line]** - `dist/core/symbol-index.js:18` — **Performance**
* `findRepoRoot()` calls `execFileSync('git', ...)` with a 5-second timeout. This is invoked from `ProjectContext._resolveFromMcpRoots()` for every allowed directory and from `edit_file.js` on every edit. In the HTTP server, a concurrent request performing symbol indexing will block the event loop for up to 5 seconds, freezing all other sessions.
  * **Remediation:** Replace `execFileSync` with `execFile` (async) or `promisify(execFile)`. Cache repo-root lookups per directory to avoid repeated shelling out.

### 5. `refactor_batch.js` Exceeds All Complexity Thresholds
* **[File:Line]** - `dist/tools/refactor_batch.js` (1,061 lines) — **Maintainability**
* The file violates every structural threshold: >500 lines, functions >50 lines, deep nesting, and god-tool anti-pattern. The custom payload parser (`parsePayload`, line 93) relies on a regex (`/\n(?=[A-Za-z_$][\w$.]*\s+\d)/`) that only matches ASCII identifiers and will silently fail on Unicode symbol names (e.g., Rust's `Résumé`).
  * **Remediation:** Decompose into sub-modules: `query.js`, `loadDiff.js`, `apply.js`, `reapply.js`, `restore.js`, `payload-parser.js`. Replace the regex-based parser with a robust line-oriented state machine or a small PEG grammar.

### 6. Duplicate Edit Application Logic with Divergent Behavior
* **[File:Line]** - `dist/core/lib.js:190` and `dist/core/edit-engine.js:141` — **Correctness / Maintainability**
* `lib.js` contains `applyFileEdits` (a legacy implementation with exact-match, trim-match, and indent-stripped match logic). `edit-engine.js` contains `applyEditList` (a newer implementation with block, symbol, and content modes, plus `disambiguations` support). Tool handlers call `applyEditList`, but `applyFileEdits` remains exported and may still be referenced by other consumers. The two implementations handle indentation re-insertation differently, creating risk of divergent behavior.
  * **Remediation:** Deprecate and remove `applyFileEdits` from `lib.js`. Consolidate all edit logic in `edit-engine.js`.

### 7. Off-By-One in Stash Attempt Limit
* **[File:Line]** - `dist/core/stash.js:43` — **Logic Error**
* `consumeAttempt` uses `if (next > MAX_ATTEMPTS)` instead of `>=`. With `MAX_ATTEMPTS = 2`, three consume calls are permitted before deletion. The test suite (`stash-core.test.js:79-88) explicitly documents this bug.
  * **Remediation:** Change `next > MAX_ATTEMPTS` to `next >= MAX_ATTEMPTS`.

### 8. Write-File Append Overlap Detection Bug
* **[File:Line]** - `dist/tools/write_file.js:73` — **Logic Error / Data Corruption**
* `findResumeOffset` is called with `existingLines` from `existing.split('\n')`. If the existing file ends with a trailing newline, `split('\n')` produces a trailing empty string. This breaks the overlap comparison, causing the last line to be duplicated on append. The test suite (`write-file.test.js:92-112`) documents this bug.
  * **Remediation:** Strip the trailing empty element from `existingLines` when the original string ends with `\n` before calling `findResumeOffset`.

### 9. Unbounded Module-Level Cache Growth in HTTP Server
* **[File:Line]** - `dist/tools/refactor_batch.js:29-33` — **Performance / Memory Leak**
* `_loadCache`, `_payloadCache`, and `_retryState` are module-level `Map`s keyed by `${repoRoot}::${sessionId}`. Session entries are never evicted, even though the HTTP server reaps idle sessions after 30 minutes. In a long-running server with many unique sessions, these maps grow without bound, eventually causing an OOM.
  * **Remediation:** Attach caches to the session object (`ctx`) so they are garbage-collected when the session is reaped. Alternatively, implement a TTL or LRU eviction policy.

---

## 💡 Suggestions & Code Smells (Maintainability, Complexity Thresholds)

### 1. Missing TypeScript Sources for Core Modules
* **[File:Line]** — **Build / Source Integrity**
* `dist/core/`, `dist/tools/`, `dist/cli/`, and `dist/server/` contain hand-authored JavaScript with no corresponding `.ts` source in `src/`. The `prebuild` script explicitly aborts if `dist/core/server.js` is missing, preventing accidental destruction of the only copy. This means the project cannot be rebuilt from source.
  * **Remediation:** Either migrate the remaining JS modules to TypeScript in `src/` and have `tsc` compile them, or document explicitly that `dist/core/`, `dist/tools/`, etc., are hand-authored source (not build output) and adjust the build pipeline accordingly.

### 2. Tests Depend on Pre-Built `dist/`
* **[File:Line]** — **Test Reliability**
* All 21 test files import from `../dist/core/...` or `../dist/tools/...`. Running tests without a successful `npm run build` first produces module-resolution errors. The `prepare` script auto-runs build, but this is a footgun in development.
  * **Remediation:** If the JS in `dist/` is canonical source, tests should import directly from those paths with a documented note. If TypeScript sources are intended to be canonical, tests should import from `../src/...` and use `tsx` or `ts-node` for test execution.

### 3. No Tests for HTTP Server or Adapter/Config Modules
* **[File:Line]** — **Test Coverage**
* `dist/server/http.js` (304 lines) has zero test coverage. The `src/adapters/` and `src/config/` modules (65 TypeScript files) also have no tests. Given that the HTTP server handles authentication, session isolation, and transport protocol switching, this is a significant coverage gap.
  * **Remediation:** Add integration tests for the HTTP server using `supertest` and mock MCP transports. Add unit tests for at least the adapter base class and the Zenith-MCP config normalizer.

### 4. `nosemgrep` Comments Indicate Suppressed Static Analysis Findings
* **[File:Line]** — **Code Smell**
* `// nosemgrep` comments appear in `search_files.js`, `symbol-index.js`, `edit-engine.js`, and others. These indicate that Semgrep flagged issues (likely security or correctness rules) that were suppressed inline rather than fixed.
  * **Remediation:** Audit every `nosemgrep` suppression. Document the justification for each, or fix the underlying issue and remove the comment.

### 5. Magic Numbers and Lack of Named Constants
* **[File:Line]** — **Maintainability**
* Scattered magic numbers: `512 * 1024` (max file size), `50` (batch size), `5000` (max files), `30_000` (timeouts), `2` (max attempts). These appear in multiple files with no shared constants module.
  * **Remediation:** Extract into a shared `constants.js` or config object: `MAX_INDEX_FILE_SIZE`, `INDEX_BATCH_SIZE`, `DEFAULT_TIMEOUT_MS`, etc.

### 6. `tree-sitter.js` Cache Uses MD5 for Non-Cryptographic Hashing
* **[File:Line]** - `dist/core/tree-sitter.js:237` — **Code Smell**
* `sourceHash()` uses `createHash('md5')` to key the symbol cache. While MD5 is acceptable for deduplication, it is deprecated for any security-sensitive use. The current usage is safe, but it creates a pattern that future contributors may copy incorrectly.
  * **Remediation:** Replace with `crypto.createHash('sha256')` or a fast non-crypto hash like `fnv1a` for cache keys.

### 7. Symbol Cache Key Collides on Prefix Inputs
* **[File:Line]** - `dist/core/tree-sitter.js:298` — **Correctness**
* The cache key is `sourceHash(langName + ':' + source)`. Because there is no delimiter between `langName` and `source`, inputs like `lang='ts', source=':foo'` and `lang='t', source='s:foo'` produce the same key. The collision probability is low in practice but violates the hash invariant.
  * **Remediation:** Use a structured hash: `sourceHash(JSON.stringify({ lang: langName, source }))` or a length-prefixed concatenation.

### 8. `http.js` Does Not Limit Request Body Size on Non-JSON Routes
* **[File:Line]** - `dist/server/http.js:110` — **Performance**
* `express.json({ limit: '4mb' })` applies globally, but raw or text bodies on other routes (if any are added later) would not be limited. Additionally, there is no rate-limiting middleware on the auth or health endpoints.
  * **Remediation:** Add `express.raw({ limit: '4mb' })` or similar if binary uploads are expected. Consider adding `express-rate-limit` to the bearer-token middleware to mitigate brute-force token guessing.

---

## ✅ Passing Notes

- **Atomic writes** (temp file + `fs.rename`) are used consistently across `write_file.js`, `edit_file.js`, `lib.js`, and `refactor_batch.js`, preventing partial-file corruption on crash.  
- **Bearer-token authentication** in `http.js` correctly uses `crypto.timingSafeEqual` to prevent timing attacks.  
- **Path validation** in `lib.js` follows symlinks with `fs.realpath` and re-checks the resolved path against allowed directories, which is a strong security primitive.

---

## Dependency & Architecture Notes

| Area | Finding |
|------|---------|
| **Package boundary** | Single `package.json`, no monorepo workspace. |
| **Cross-package deps** | `dist/` (JS) imports `src/` (TS) compiled output; `src/retrieval/` imports from `dist/core/`. This circular build dependency is manageable because `dist/core/` is hand-authored JS, but it is architecturally unusual. |
| **External deps** | `better-sqlite3`, `web-tree-sitter`, `express`, `zod`, `diff`, `js-yaml`, `@iarna/toml`, `json5`, `minimatch`, `glob`. No known vulnerable versions detected at scan time. |
| **Native deps** | `better-sqlite3` (SQLite bindings) and `web-tree-sitter` (WASM) both load native binaries. Ensure `npm ci` runs on the target architecture. |

---

*End of review.*
