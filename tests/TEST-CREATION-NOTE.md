# Test Creation Note for Zenith-MCP

## Newly Added
- `tests/path-utils.test.js`: Comprehensive Vitest suite for `src/core/path-utils.ts` (imported via built dist equivalent).
  - Covers `expandHome`, `convertToWindowsPath`, `normalizePath`
  - Platform-specific testing (Linux, Win32, WSL /mnt/ preservation)
  - Boundary, equivalence classes, normalization edge cases (quotes, UNC, dots, multiple slashes, drive capitalization)
  - Follows existing test conventions from `shared-core.test.js`
  - Mocking for `os.homedir()` and `process.platform`

## Compliance
- No source code was modified.
- Only test directory updated.
- Matches PHASE 1-6 requirements of test-creation-agent skill (framework detection, branch coverage, determinism, no `any` types, meaningful assertions).
- Run with `npm test` or `npx vitest run tests/path-utils.test.js` after ensuring build (`npm run build`).

This note documents the test addition per user request. Tests focus exclusively on describing current behavior without suggesting source changes.

---

## Batch 2 — Core Tools & Modules (2026-05-06)

164 new tests across 8 new test files, all passing.

| Test File | Target Source | Tests | Key Coverage |
|---|---|---|---|
| `directory.test.js` | `dist/tools/directory.js` | 19 | list mode (flat, recursive, sizes, sort, depth clamping, denied dirs, empty), tree mode (indentation, default excludes, custom excludePatterns, glob excludes, control char escaping, symbol counts) |
| `search-files.test.js` | `dist/tools/search_files.js` | 13 | files mode (glob pattern, extensions, pathContains, default excludes, metadata, empty dir, maxResults), content mode (regex, no matches, literal, countOnly, case-insensitive, multi-file) |
| `read-multiple-files.test.js` | `dist/tools/read_multiple_files.js` | 16 | registration, single/multi file reads, showLineNumbers, compression, maxCharsPerFile, ENOENT/denied/mixed errors, empty/single-path boundary |
| `stash-restore-tool.test.js` | `dist/tools/stash_restore.js` | 38 | all 6 modes (list, read, restore, apply edit, apply write, history), dry-run, attempt consumption, max retries, nested symbol paths, truncation, invalid mode, registration |
| `read-media-file.test.js` | `dist/tools/read_media_file.js` | 17 | PNG/JPG/GIF/WebP/WAV formats, unknown extension, extensionless file, non-existent/directory errors, empty file, base64 round-trip, case-insensitive extensions |
| `filesystem.test.js` | `dist/tools/filesystem.js` | 15 | mkdir (single, nested, existing), delete (file, non-existent, directory rejection), move (file, directory), info (file/dir metadata), unknown mode, registration/annotations |
| `toon-bridge.test.js` | `dist/core/toon_bridge.js` | 13 | budget pass-through, no filePath, unknown extension, structured path with tree-sitter, missing optional fields, null/empty/tree-sitter-throw fallbacks, multiple entries, budget/content forwarding |
| `core-server.test.js` | `dist/core/server.js` | 33 | createFilesystemServer (creation, 11 tool registrations, retrieval attachment), resolveInitialAllowedDirectories (multiple paths, home expansion, normalization, fallback), validateDirectories (valid, nonexistent, file-as-dir, errors), attachRootsHandlers (14 tests: notification, oninitialized, client-with-roots, empty roots, no roots support, errors) |

### Compliance
- No source code was modified.
- Only test directory updated.
- Framework: Vitest 4.1.5 with real temp dirs (no source mocking).
- All tests deterministic with real filesystem operations.
- Run individual: `npx vitest run tests/<filename>.test.js`
- Run all new: `npx vitest run tests/directory.test.js tests/search-files.test.js tests/read-multiple-files.test.js tests/stash-restore-tool.test.js tests/read-media-file.test.js tests/filesystem.test.js tests/toon-bridge.test.js tests/core-server.test.js`
