# Test Suite: Discovered Bugs & Failures

This document catalogs bugs and test failures discovered during comprehensive test suite generation.

**Date:** 2026-04-26
**Test Runner:** Vitest 4.1.5
**Total Tests:** 270 (263 pass, 7 fail)

---

## 1. Source Code Bugs (Confirmed by Tests)

### BUG-001: `write_file.js` — Overlap Detection Fails When File Ends With Newline

**File:** `dist/tools/write_file.js:8-31` (`findResumeOffset`)
**Test:** `tests/write-file.test.js > overlap detection fails when existing file ends with newline (BUG)`
**Severity:** Medium

**Description:**
When appending to a file that ends with `\n`, the overlap detection in `findResumeOffset()` fails to detect overlapping lines between the existing file tail and the incoming content. This causes the entire incoming content to be appended without deduplication.

**Root Cause:**
`String.split('\n')` produces a trailing empty string element when the source string ends with `\n`. For example, `"aaa\nbbb\nccc\n".split('\n')` yields `['aaa', 'bbb', 'ccc', '']`. When the overlap check iterates the tail lines, it finds `bbb` at index 1, sets `overlapLen = Math.min(4 - 1, 5) = 3`, but the third comparison is `'' === 'ddd'` (comparing the trailing empty string with an actual content line), which fails. The overlap is not detected.

**Impact:**
Duplicate content when using `append: true` with overlapping line content. The LLM agent sends content that partially overlaps the existing file tail, but the overlap is not stripped, resulting in duplicated lines.

**Fix Suggestion:**
Filter trailing empty strings from `existingLines` and `incomingLines` before comparison, or adjust `overlapLen` calculation to exclude the trailing empty element.

---

### BUG-002: `stash.js` — `consumeAttempt` Off-By-One in MAX_ATTEMPTS Check

**File:** `dist/core/stash.js:43`
**Test:** `tests/stash-core.test.js > consumeAttempt deletes entry after MAX_ATTEMPTS (2) exceeded`
**Severity:** Low (behavioral, not crash)

**Description:**
`MAX_ATTEMPTS = 2` is documented as "2-attempt limit". The check on line 43 uses `if (next > MAX_ATTEMPTS)` which means `consumeAttempt()` returns `true` on the 2nd call (when `next=2`, `2 > 2` is `false`). The entry is only deleted on the 3rd call (`next=3`, `3 > 2` is `true`).

This means the effective retry budget is **3 `consumeAttempt` calls** (attempts go 0→1→2→3, deleted at 3), not 2 as documented. If the intent is "allow 2 retries total", the check should be `>=` instead of `>`.

---

## 2. Pre-Existing Test Failures (Bugs in Source Code)

These failures exist in test files that were created before this test generation effort. All expose real source code bugs.

### PBUG-001: `path-utils.js` — `normalizePath` Does Not Resolve Dot Segments

**File:** `dist/core/path-utils.js`
**Test:** `tests/path-utils.test.js > path-utils normalizePath > resolves dot segments`
**Actual:** `normalizePath('/home/./user')` returns `'/home/./user'`
**Expected:** `'/home/user'`

The function does not resolve `.` or `..` path segments. This means paths like `/home/../user` also remain unresolved. While `path.resolve()` in `validatePath()` handles this downstream, `normalizePath()` itself produces non-canonical paths.

---

### PBUG-002: `path-utils.js` — `normalizePath` Returns `.` for Empty String

**File:** `dist/core/path-utils.js`
**Test:** `tests/path-utils.test.js > path-utils normalizePath > handles empty string`
**Actual:** `normalizePath('')` returns `'.'`
**Expected:** `''`

Likely caused by `path.resolve('')` returning the current working directory (`.`).

---

### PBUG-003: `path-utils.js` — `normalizePath` Does Not Expand Tilde After Quote Stripping

**File:** `dist/core/path-utils.js`
**Test:** `tests/path-utils.test.js > path-utils integration > handles quoted tilde paths`
**Actual:** `normalizePath('"~/test"')` returns `'~/test'`
**Expected:** `'/home/<user>/test'`

`normalizePath` strips surrounding quotes but does not call `expandHome()`. The two functions must be composed manually by callers.

---

### PBUG-004: `compression.js` — `isCompressionUseful` Has Counter-Intuitive Budget Logic

**File:** `dist/core/compression.js:16-24`
**Test:** `tests/compression-utils.test.js > isCompressionUseful` (3 test cases)

**Case 1:** `isCompressionUseful('hello world hello world', 'hello', 10)` returns `true` but test expects `false`.
- Raw=22, compressed=5, maxChars=10, budget=min(10,15)=10. Compressed (5) < budget (10) → true.
- The test name says "compressed exceeds target budget" but the compressed text (5 chars) is well within budget.

**Case 2:** `isCompressionUseful('a'.repeat(1000), 'a'.repeat(400), 10000, 0.5)` returns `true` but test expects `false`.
- Budget=min(10000, 500)=500. Compressed (400) < budget (500) → true.

**Case 3:** `isCompressionUseful('test', 't', 4)` returns `true` but test expects `false`.
- Budget=min(4, 2)=2. Compressed (1) < budget (2) → true.

**Analysis:** The source code behavior is internally consistent with its documented purpose: it checks whether compression produces output smaller than both the raw text and the computed budget. The test expectations appear to encode a different understanding of the API. Either the tests or the implementation may need alignment, but the tests were not written by this test generation effort.

---

### PBUG-005: `compression.js` — `truncateToBudget` Does Not Mark Newline-Only Text as Truncated

**File:** `dist/core/compression.js:26-42`
**Test:** `tests/compression-utils.test.js > truncateToBudget > handles text with only newlines`
**Actual:** `truncateToBudget('\n\n\n', 10)` returns `{ text: '\n\n\n', truncated: false }`
**Expected:** `{ truncated: true }`

The text (3 chars) fits within the budget (10), so `truncated` is correctly `false`. The test expectation appears incorrect — no truncation is needed when the text fits within budget.

---

## 3. Test Coverage Summary

### New Test Files Created (8 files, ~124 new tests)

| Test File | Module Tested | Tests |
|---|---|---|
| `tests/lib-utilities.test.js` | `dist/core/lib.js` — formatSize, normalizeLineEndings, countOccurrences, diffs | 22 |
| `tests/edit-engine-core.test.js` | `dist/core/edit-engine.js` — findMatch, applyEditList (content/block/symbol), syntaxWarn | 30 |
| `tests/stash-core.test.js` | `dist/core/stash.js` — CRUD, consumeAttempt TTL, convenience wrappers | 14 |
| `tests/write-file.test.js` | `dist/tools/write_file.js` — create, overwrite, append, failIfExists, overlap detection | 12 |
| `tests/project-context.test.js` | `dist/core/project-context.js` — resolution ladder, getStashDb, initProject, refresh, singleton | 11 |
| `tests/edit-file-tool.test.js` | `dist/tools/edit_file.js` — tool handler registration, content/block/dryRun modes | 10 |
| `tests/symbol-index-core.test.js` | `dist/core/symbol-index.js` — findRepoRoot, getSessionId, snapshotSymbol, version CRUD, prune | 15 |
| `tests/lib-filesystem-context.test.js` | `dist/core/lib.js` — createFilesystemContext, validatePath, allowed directories | 10 |

### Previously Existing Tests (11 files, 146 tests)

All existing test files were preserved without modification. 7 failures in pre-existing tests were identified and documented above.
