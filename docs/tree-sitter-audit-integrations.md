# Tree-Sitter Integration Audit — Zenith-MCP

_Audited: 2026-05-15_  
_Scope: all source files that import from `src/core/tree-sitter.ts`_

---

## 0. Runtime Path Resolution

`tree-sitter.ts` is compiled to `dist/core/tree-sitter.js`. At runtime, `__dirname` resolves
to `dist/core/`. The three path constants are therefore:

| Constant | Resolved path |
|---|---|
| `TS_WASM_PATH` | `dist/grammars/tree-sitter.wasm` |
| `GRAMMARS_DIR` | `dist/grammars/grammars/` |
| `QUERIES_DIR` | `dist/grammars/queries/` |

Source grammars live at `packages/zenith-mcp/grammars/` and are copied into `dist/grammars/`
by the build process. The source path `src/grammars/` does **not** exist.

---

## 1. Language Registry Table

The `EXT_TO_LANG` map in `src/core/tree-sitter.ts` defines all supported extensions.
Each `langName` drives the WASM file name (`tree-sitter-{langName}.wasm`) and the
flat query file (`{langName}-tags.scm`).

| Language name | Extensions | WASM loaded | Query file loaded |
|---|---|---|---|
| `javascript` | `.js` `.mjs` `.cjs` `.jsx` | `tree-sitter-javascript.wasm` | `javascript-tags.scm` |
| `typescript` | `.ts` `.mts` `.cts` | `tree-sitter-typescript.wasm` | `typescript-tags.scm` |
| `tsx` | `.tsx` | `tree-sitter-tsx.wasm` | `tsx-tags.scm` |
| `python` | `.py` `.pyi` | `tree-sitter-python.wasm` | `python-tags.scm` |
| `bash` | `.sh` `.bash` `.zsh` | `tree-sitter-bash.wasm` | `bash-tags.scm` |
| `go` | `.go` | `tree-sitter-go.wasm` | `go-tags.scm` |
| `rust` | `.rs` | `tree-sitter-rust.wasm` | `rust-tags.scm` |
| `java` | `.java` | `tree-sitter-java.wasm` | `java-tags.scm` |
| `c` | `.c` `.h` | `tree-sitter-c.wasm` | `c-tags.scm` |
| `cpp` | `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` | `tree-sitter-cpp.wasm` | `cpp-tags.scm` |
| `csharp` | `.cs` | `tree-sitter-csharp.wasm` | `csharp-tags.scm` |
| `kotlin` | `.kt` `.kts` | `tree-sitter-kotlin.wasm` | `kotlin-tags.scm` |
| `php` | `.php` | `tree-sitter-php.wasm` | `php-tags.scm` |
| `ruby` | `.rb` `.rake` `.gemspec` | `tree-sitter-ruby.wasm` | `ruby-tags.scm` |
| `swift` | `.swift` | `tree-sitter-swift.wasm` | `swift-tags.scm` |
| `css` | `.css` `.scss` | `tree-sitter-css.wasm` | `css-tags.scm` |
| `json` | `.json` `.jsonc` | `tree-sitter-json.wasm` | `json-tags.scm` |
| `yaml` | `.yaml` `.yml` | `tree-sitter-yaml.wasm` | `yaml-tags.scm` |
| `sql` | `.sql` | `tree-sitter-sql.wasm` | `sql-tags.scm` |
| `markdown` | `.md` `.mdx` | `tree-sitter-markdown.wasm` | `markdown-tags.scm` |

**Total: 20 registered language names, 46 mapped extensions.**

All 20 languages have their WASM and `-tags.scm` present on disk. None silently fail
to load at the extension-registry level.

---

## 2. Per-File Tree-Sitter Usage

### 2.1 `src/core/symbol-index.ts`

**Imports:** `getSymbols`, `getLangForFile`, `isSupported`

| Call site | Function | Trigger | Query type |
|---|---|---|---|
| `indexDirectory` walker | `isSupported(fullPath)` | filter files to index | none — extension check only |
| `indexFile` | `getLangForFile(absFilePath)` | detect language per file | none — extension lookup |
| `indexFile` | `getSymbols(source, langName)` | extract defs + refs for SQLite | `{lang}-tags.scm` |

Query mode: **both** `definition.*` and `reference.*` captures — unfiltered.

---

### 2.2 `src/core/edit-engine.ts`

**Imports:** `getLangForFile`, `findSymbol`, `checkSyntaxErrors`

| Call site | Function | Trigger | Query type |
|---|---|---|---|
| `applyEditList` (mode=`symbol`) | `getLangForFile(filePath)` | detect language | none |
| `applyEditList` (mode=`symbol`) | `findSymbol(content, langName, edit.symbol!, {kindFilter:'def'})` | locate symbol bounds | `{lang}-tags.scm` (defs only) |
| `syntaxWarn` | `getLangForFile(filePath)` | detect language | none |
| `syntaxWarn` | `checkSyntaxErrors(content, langName)` | post-edit syntax validation | **none** — WASM parse only |

**Explicit skips in `syntaxWarn`:** `.scss`, `.mdx`, `.jsonc` short-circuit to `return ''`
before any tree-sitter call. Syntax checking is suppressed for these three extensions.

---

### 2.3 `src/core/project-context.ts`

No tree-sitter calls.

---

### 2.4 `src/core/toon_bridge.ts`

**Imports:** `getCompressionStructure`, `getLangForFile`

| Call site | Function | Trigger | Query type |
|---|---|---|---|
| `compressToon` | `getLangForFile(filePath)` | detect language | none |
| `compressToon` | `getCompressionStructure(content, langName)` | extract block structure | `{lang}-tags.scm` (defs) + WASM walk if in `COMPRESSION_ANCHOR_RULES` |

`COMPRESSION_ANCHOR_RULES` is hardcoded to: `javascript`, `typescript`, `tsx`, `python`.
All other registered languages get block structure only — no anchor data.

---

### 2.5 `src/tools/search_file.ts`

**Imports:** `getLangForFile`, `findSymbol`

| Mode | Function | Query type |
|---|---|---|
| `symbol` | `findSymbol(source, langName, args.symbol, {kindFilter:'def'})` | `{lang}-tags.scm` (defs only) |
| `grep` | — | no tree-sitter calls |

---

### 2.6 `src/tools/search_files.ts`

**Imports:** `isSupported`, `getLangForFile`, `getDefinitions`, `getStructuralFingerprint`, `computeStructuralSimilarity`

| Mode | Function | Query type |
|---|---|---|
| all modes (filtering) | `isSupported(f)` | none — extension check |
| `symbol` / `definition` | `getDefinitions(source, langName, opts)` | `{lang}-tags.scm` (defs only) |
| `structural` | `getStructuralFingerprint(source, lang, ...)` | **none** — WASM parse only, raw AST node type walk |
| `files` / `content` | — | no tree-sitter calls |

---

### 2.7 `src/tools/refactor_batch.ts`

**Imports:** `getLangForFile`, `findSymbol`, `getSymbolStructure`, `checkSyntaxErrors`

| Operation | Function | Query type |
|---|---|---|
| `loadDiff` — locate symbol | `findSymbol(source, langName, symbol, {kindFilter:'def'})` | `{lang}-tags.scm` (defs only) |
| `loadDiff` — outlier detection | `getSymbolStructure(source, langName, line, endLine)` | **none** — WASM only |
| `apply` / `reapply` — syntax gates | `checkSyntaxErrors(content, langName)` | **none** — WASM only |
| `restore` — locate symbol | `findSymbol(content, langName, symbol, {kindFilter:'def'})` | `{lang}-tags.scm` (defs only) |
| `restore` — syntax check | `checkSyntaxErrors(newContent, langName)` | **none** — WASM only |

---

### 2.8 `src/tools/directory.ts`

**Imports:** `isSupported`, `getFileSymbolSummary`, `getFileSymbols`

| Mode | Function | Query type |
|---|---|---|
| `tree` — filtering | `isSupported(fullPath)` | none |
| `tree` (showSymbols=true) | `getFileSymbolSummary(fullPath)` | `{lang}-tags.scm` (defs only) |
| `tree` (showSymbolNames=true) | `getFileSymbols(fullPath, {kindFilter:'def'})` | `{lang}-tags.scm` (defs only) |
| `list` | — | no tree-sitter calls |

`getFileSymbolSummary` has a 256 KB size guard; `getFileSymbols` does not.

---

## 3. Complete Call Chains

```
search_file (symbol mode)
  └─ findSymbol(source, langName, symbol, {kindFilter:'def'})
       └─ getSymbols → getCompiledQuery(langName)
            ├─ loadLanguage(langName)    → GRAMMARS_DIR/tree-sitter-{lang}.wasm
            └─ loadQueryString(langName) → QUERIES_DIR/{lang}-tags.scm
                 └─ query.matches(tree.rootNode)

search_files (symbol / definition mode)
  └─ getDefinitions(source, langName, opts)
       └─ getSymbols → [same chain as above]

search_files (structural mode)
  └─ getStructuralFingerprint(source, lang, ...)
       └─ loadLanguage(langName)         → WASM only, raw AST node type walk

symbol-index (indexFile)
  └─ getSymbols(source, langName)        → both defs AND refs via tags query

edit-engine (symbol edit)
  └─ findSymbol → [tags query chain]

edit-engine (syntax warn)
  └─ [guard: skip .scss, .mdx, .jsonc]
  └─ checkSyntaxErrors(content, langName)
       └─ loadLanguage(langName)         → WASM only, ERROR node walk

refactor_batch (loadDiff)
  ├─ findSymbol → [tags query chain]
  └─ getSymbolStructure → WASM only, CST parameter/modifier walk

refactor_batch (apply / reapply)
  └─ checkSyntaxErrors → WASM only

refactor_batch (restore)
  ├─ findSymbol → [tags query chain]
  └─ checkSyntaxErrors → WASM only

directory (tree mode)
  ├─ getFileSymbolSummary → getSymbols → [tags query chain]
  └─ getFileSymbols → getSymbols(kindFilter:'def') → [tags query chain]

toon_bridge (compressToon)
  └─ getCompressionStructure(content, langName)
       ├─ getDefinitions → [tags query chain]
       └─ [if in COMPRESSION_ANCHOR_RULES] loadLanguage → WASM only, anchor walk
```

---

## 4. Runtime vs. Registered Gap

All 20 registered languages are runtime-reachable — no tool hardcodes a specific language.
Language selection is always driven by file extension via `getLangForFile`.

**One partially functional registered language:**

| Language | Extensions | Issue |
|---|---|---|
| `css` (for `.scss`) | `.scss` | `.scss` parsed with CSS grammar. `tree-sitter-scss.wasm` + `scss-tags.scm` exist on disk but are never loaded. Post-edit syntax checking suppressed for `.scss`. Symbol extraction may be incorrect for SCSS-specific constructs (`$variables`, `@mixin`, nesting). |

**Exported functions with no direct tool caller:**

| Function | Status |
|---|---|
| `getSupportedExtensions` | Exported, never imported in audited files |
| `treeSitterAvailable` | Exported, never imported in audited files |
| `getCompressionStructure` | Called by `toon_bridge.ts` only — not a direct MCP tool |

---

## 5. Query Type Gap

### 5.1 Only one query type is ever loaded

`loadQueryString` always resolves to:
```typescript
const scmPath = path.join(QUERIES_DIR, `${langName}-tags.scm`);
```

**No code reads from the per-language subdirectories** (`queries/javascript/`, `queries/python/`, etc.).

### 5.2 Query files: loaded vs. never loaded

| Query type | Pattern | Loaded at runtime | Count |
|---|:---:|:---:|---|
| `{lang}-tags.scm` | `queries/{lang}-tags.scm` | **YES** | 36 files |
| `definitions.scm` | `queries/{lang}/definitions.scm` | **NO** | 36 files |
| `references.scm` | `queries/{lang}/references.scm` | **NO** | 32 files |
| `locals.scm` | `queries/{lang}/locals.scm` | **NO** | 36 files |
| `injections.scm` | `queries/{lang}/injections.scm` | **NO** | 13 files |

**Total dead query files on disk: 117 `.scm` files in subdirectories, never read.**

The subdirectory files appear to be the source components from which each flat `-tags.scm`
was built. They are maintained for reference but play no role at runtime.

### 5.3 Flat `-tags.scm` files that exist but are unreachable

These files have correct WASM + query coverage but no extension mapped to them in `EXT_TO_LANG`:

| File | Missing extension mapping |
|---|---|
| `dockerfile-tags.scm` | no `.dockerfile` mapping |
| `graphql-tags.scm` | no `.graphql` mapping |
| `hcl-tags.scm` | no `.tf` / `.hcl` mapping |
| `html-tags.scm` | no `.html` mapping |
| `lua-tags.scm` | no `.lua` mapping |
| `nix-tags.scm` | no `.nix` mapping |
| `prisma-tags.scm` | no `.prisma` mapping |
| `proto-tags.scm` | no `.proto` mapping |
| `query-tags.scm` | no `.scm` mapping (meta-language) |
| `regex-tags.scm` | no extension mapping (embedded language) |
| `scss-tags.scm` | `.scss` → `css` by design — `scss` key unreachable |
| `svelte-tags.scm` | no `.svelte` mapping |
| `toml-tags.scm` | no `.toml` mapping |
| `vue-tags.scm` | no `.vue` mapping |
| `xml-tags.scm` | no `.xml` mapping |
| `c_sharp-tags.scm` | registry uses `csharp` key, not `c_sharp` |

**16 flat `-tags.scm` files on disk never loaded at runtime.**

---

## 6. WASM Files: Loaded vs. Never Loaded

### 6.1 Loaded (20)

`javascript`, `typescript`, `tsx`, `python`, `bash`, `go`, `rust`, `java`, `c`, `cpp`,
`csharp`, `kotlin`, `php`, `ruby`, `swift`, `css`, `json`, `yaml`, `sql`, `markdown`

### 6.2 Never loaded (23)

| WASM file | Reason |
|---|---|
| `tree-sitter-cmake.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-dart.wasm` | not in `EXT_TO_LANG`; no `.dart` mapping |
| `tree-sitter-dockerfile.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-elixir.wasm` | not in `EXT_TO_LANG`; no `.ex`/`.exs` mapping |
| `tree-sitter-graphql.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-hcl.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-html.wasm` | not in `EXT_TO_LANG`; no `.html` mapping |
| `tree-sitter-ini.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-lua.wasm` | not in `EXT_TO_LANG`; no `.lua` mapping |
| `tree-sitter-make.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-nix.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-perl.wasm` | not in `EXT_TO_LANG`; no `.pl`/`.pm` mapping |
| `tree-sitter-prisma.wasm` | not in `EXT_TO_LANG`; no `.prisma` mapping |
| `tree-sitter-proto.wasm` | not in `EXT_TO_LANG`; no `.proto` mapping |
| `tree-sitter-query.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-r.wasm` | not in `EXT_TO_LANG`; no `.r` mapping |
| `tree-sitter-regex.wasm` | not in `EXT_TO_LANG` |
| `tree-sitter-scss.wasm` | `.scss` → `css`; `scss` key never selected |
| `tree-sitter-svelte.wasm` | not in `EXT_TO_LANG`; no `.svelte` mapping |
| `tree-sitter-toml.wasm` | not in `EXT_TO_LANG`; no `.toml` mapping |
| `tree-sitter-vue.wasm` | not in `EXT_TO_LANG`; no `.vue` mapping |
| `tree-sitter-xml.wasm` | not in `EXT_TO_LANG`; no `.xml` mapping |
| `tree-sitter-c_sharp.wasm` | registry uses `csharp` key, not `c_sharp` |

---

## 7. Hardcoded Language Names and Mappings

### 7.1 `COMPRESSION_ANCHOR_RULES` (in `tree-sitter.ts`)

Anchor extraction only runs for: **`javascript`, `typescript`, `tsx`, `python`**.

All other registered languages (`go`, `rust`, `java`, `c`, `cpp`, `csharp`, `kotlin`,
`php`, `ruby`, `swift`, `css`, `json`, `yaml`, `sql`, `markdown`, `bash`) return block
structure only — `anchors` array is empty. No error is thrown.

### 7.2 `DEF_TYPES` set in `getSymbolStructure`

Hardcoded AST node type strings (primarily JS/TS names):
```
function_declaration, function_definition, method_definition,
arrow_function, function, method,
class_declaration, class_definition,
function_signature, method_signature,
lexical_declaration, variable_declaration
```

Other languages use different AST node names. `getSymbolStructure` returns `null`
for unmatched nodes, causing outlier detection in `refactor_batch` to silently skip
those occurrences.

### 7.3 Explicit extension skips in `syntaxWarn` (`edit-engine.ts`)

```typescript
if (['.scss', '.mdx', '.jsonc'].includes(ext)) return '';
```

These three extensions are registered (`.scss` → `css`, `.mdx` → `markdown`,
`.jsonc` → `json`) but explicitly excluded from post-edit syntax validation because
their mapped grammars produce false-positive parse errors for the dialect-specific syntax.

---

## 8. Summary of All Gaps

| Gap | Severity | Detail |
|---|---|---|
| `.scss` parsed with CSS grammar | **Medium** | `tree-sitter-scss.wasm` + `scss-tags.scm` exist but are never loaded. CSS grammar parses SCSS. Syntax checking suppressed as workaround. Symbol extraction may be incorrect for SCSS-specific constructs. |
| 23 WASM files on disk, never loaded | **Informational** | Languages present in grammars dir but absent from `EXT_TO_LANG`. Adding extension entries would activate them. |
| 16 flat `-tags.scm` files never loaded | **Informational** | Full query coverage exists on disk for unregistered languages. |
| 117 subdirectory `.scm` files never read | **Informational** | Only flat `{lang}-tags.scm` files are loaded. Subdirectory files (`definitions.scm`, `references.scm`, `locals.scm`, `injections.scm`) are dead at runtime. |
| `c_sharp` vs `csharp` naming duplication | **Low** | Two complete redundant sets on disk. `c_sharp` set never loaded. No functional impact; wastes disk space. |
| `COMPRESSION_ANCHOR_RULES` covers only 4 languages | **Low** | `getCompressionStructure` returns no anchor data for 16 of 20 registered languages. Silently degrades toon compression quality. |
| `getSymbolStructure` DEF_TYPES is JS/TS-centric | **Low** | Returns `null` for non-matching AST node types, causing silent skip in `refactor_batch` outlier detection. |
| `.mdx`, `.jsonc` syntax checking suppressed | **Low** | Registered extensions excluded from `syntaxWarn` — no post-edit error reporting for these file types. |
| `getSupportedExtensions`, `treeSitterAvailable` exported but uncalled | **Informational** | Dead API surface in the audited codebase. |
