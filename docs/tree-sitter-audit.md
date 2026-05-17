# Tree-Sitter Audit — Master Summary

_Audited: 2026-05-15_  
_Full details: [`tree-sitter-audit-grammars.md`](./tree-sitter-audit-grammars.md) · [`tree-sitter-audit-integrations.md`](./tree-sitter-audit-integrations.md)_

---

## TL;DR

| Metric | Count |
|---|---|
| WASM grammars on disk | 43 |
| Registered in `EXT_TO_LANG` (active) | 20 |
| WASM files that are never loaded | 23 |
| Flat `-tags.scm` query files on disk | 36 |
| Flat `-tags.scm` files actually loaded at runtime | 20 |
| Flat `-tags.scm` files never loaded | 16 |
| Subdirectory `.scm` files on disk | 117 |
| Subdirectory `.scm` files loaded at runtime | **0** |
| Query type exclusively used | `{lang}-tags.scm` (flat) |

---

## Active Languages (20)

These are the only languages Zenith-MCP will parse, query, or syntax-check at runtime.
All others on disk are completely inert.

| Language | Extensions | WASM | Query |
|---|---|:---:|:---:|
| javascript | `.js` `.mjs` `.cjs` `.jsx` | ✅ | ✅ |
| typescript | `.ts` `.mts` `.cts` | ✅ | ✅ |
| tsx | `.tsx` | ✅ | ✅ |
| python | `.py` `.pyi` | ✅ | ✅ |
| bash | `.sh` `.bash` `.zsh` | ✅ | ✅ |
| go | `.go` | ✅ | ✅ |
| rust | `.rs` | ✅ | ✅ |
| java | `.java` | ✅ | ✅ |
| c | `.c` `.h` | ✅ | ✅ |
| cpp | `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` | ✅ | ✅ |
| csharp | `.cs` | ✅ | ✅ |
| kotlin | `.kt` `.kts` | ✅ | ✅ |
| php | `.php` | ✅ | ✅ |
| ruby | `.rb` `.rake` `.gemspec` | ✅ | ✅ |
| swift | `.swift` | ✅ | ✅ |
| css _(also handles .scss — see gaps)_ | `.css` `.scss` | ✅ | ✅ |
| json | `.json` `.jsonc` | ✅ | ✅ |
| yaml | `.yaml` `.yml` | ✅ | ✅ |
| sql | `.sql` | ✅ | ✅ |
| markdown | `.md` `.mdx` | ✅ | ✅ |

---

## Inactive Languages (23 WASM on disk, never loaded)

These grammars and queries ship in the build but are completely unreachable.
Adding the language key + extension(s) to `EXT_TO_LANG` in `src/core/tree-sitter.ts`
would activate them instantly — all assets are already present.

| Language | WASM | Flat tags | Query dir | Blocker |
|---|:---:|:---:|:---:|---|
| dockerfile | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| graphql | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| hcl | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| html | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| lua | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| nix | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| prisma | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| proto | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| svelte | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| toml | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| vue | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| xml | ✅ | ✅ | ✅ | not in `EXT_TO_LANG` |
| c_sharp _(duplicate of csharp)_ | ✅ | ✅ | ✅ | registry uses `csharp` key |
| scss _(handled by css)_ | ✅ | ✅ | ✅ | `.scss` → `css` by design |
| cmake | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| dart | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| elixir | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| ini | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| make | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| perl | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| r | ✅ | ❌ | ❌ | not in `EXT_TO_LANG`; no queries |
| query _(tree-sitter meta)_ | ✅ | ✅ | ✅ | not in `EXT_TO_LANG`; no meaningful extension |
| regex _(embedded)_ | ✅ | ✅ | ✅ | not in `EXT_TO_LANG`; no meaningful extension |

---

## Where Tree-Sitter Is Called (Integration Map)

| File | What it calls | Query type used |
|---|---|---|
| `src/core/symbol-index.ts` | `getSymbols` (defs + refs) | `{lang}-tags.scm` |
| `src/core/edit-engine.ts` | `findSymbol` (defs), `checkSyntaxErrors` | tags (defs) + WASM only |
| `src/core/toon_bridge.ts` | `getCompressionStructure` | tags (defs) + WASM walk |
| `src/tools/search_file.ts` | `findSymbol` (defs) | `{lang}-tags.scm` (defs) |
| `src/tools/search_files.ts` | `getDefinitions`, `getStructuralFingerprint` | tags (defs) + WASM only |
| `src/tools/refactor_batch.ts` | `findSymbol`, `getSymbolStructure`, `checkSyntaxErrors` | tags (defs) + WASM only |
| `src/tools/directory.ts` | `getFileSymbolSummary`, `getFileSymbols` | `{lang}-tags.scm` (defs) |
| `src/core/project-context.ts` | — | none |

**Only one `.scm` query type is ever executed:** the flat `{lang}-tags.scm` file.  
The 117 subdirectory files (`definitions.scm`, `references.scm`, `locals.scm`, `injections.scm`) are **never read**.

---

## Known Gaps & Issues

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | `.scss` files parsed with CSS grammar | **Medium** | Add `scss` as a distinct language key in `EXT_TO_LANG`, map `.scss` to it |
| 2 | 23 WASM files shipped but never loaded | Informational | Add extension mappings to activate; remove unused to reduce bundle size |
| 3 | 117 subdirectory `.scm` files never read | Informational | Remove or consolidate into flat tags files if they serve no build purpose |
| 4 | `c_sharp` / `csharp` naming duplication | Low | Remove `c_sharp` set (WASM + query dir + flat tags) from disk |
| 5 | `COMPRESSION_ANCHOR_RULES` covers only JS/TS/Python | Low | Extend rules to cover other registered languages (go, rust, java, etc.) |
| 6 | `getSymbolStructure` DEF_TYPES is JS/TS-centric | Low | Add per-language node type mappings |
| 7 | `.mdx`, `.jsonc` syntax checking suppressed | Low | Accepted workaround — document explicitly |
| 8 | `getSupportedExtensions`, `treeSitterAvailable` exported but uncalled | Informational | Remove or wire into a health-check endpoint |

---

## Quick Wins (activate a language with one line each)

These languages have **full asset coverage** (WASM + flat-tags.scm + query dir) and only
need an entry added to `EXT_TO_LANG` in `src/core/tree-sitter.ts`:

```typescript
// One line per language to activate:
'.html': 'html',
'.vue': 'vue',
'.svelte': 'svelte',
'.toml': 'toml',
'.proto': 'proto',
'.prisma': 'prisma',
'.lua': 'lua',
'.graphql': 'graphql', '.gql': 'graphql',
'.tf': 'hcl', '.hcl': 'hcl',
'.nix': 'nix',
'.dockerfile': 'dockerfile', // or detect 'Dockerfile' by filename
'.xml': 'xml', '.svg': 'xml',
```
