# Tree-Sitter Grammar & Query Availability Audit

_Generated: 2026-05-15_

## Paths Surveyed

| Path | Contents |
|---|---|
| `packages/zenith-mcp/grammars/grammars/` | 43 `.wasm` language grammar files |
| `packages/zenith-mcp/grammars/queries/` | 36 `*-tags.scm` flat files + 36 query subdirectories |
| `packages/zenith-mcp/grammars/` (root) | 2 stray files (see Gaps §4) |

---

## Summary Table

| Language | WASM | flat-tags.scm | query-dir | query-dir .scm files |
|---|:---:|:---:|:---:|---|
| **bash** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **c** | ✅ | ✅ | ✅ | definitions, locals, references |
| **c_sharp** | ✅ | ✅ | ✅ | definitions, locals, references |
| **cmake** | ✅ | ❌ | ❌ | — |
| **cpp** | ✅ | ✅ | ✅ | definitions, locals, references |
| **csharp** | ✅ | ✅ | ✅ | definitions, locals, references |
| **css** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **dart** | ✅ | ❌ | ❌ | — |
| **dockerfile** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **elixir** | ✅ | ❌ | ❌ | — |
| **go** | ✅ | ✅ | ✅ | definitions, locals, references |
| **graphql** | ✅ | ✅ | ✅ | definitions, locals, references |
| **hcl** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **html** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **ini** | ✅ | ❌ | ❌ | — |
| **java** | ✅ | ✅ | ✅ | definitions, locals, references |
| **javascript** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **json** | ✅ | ✅ | ✅ | definitions, locals, references |
| **kotlin** | ✅ | ✅ | ✅ | definitions, locals, references |
| **lua** | ✅ | ✅ | ✅ | definitions, locals, references |
| **make** | ✅ | ❌ | ❌ | — |
| **markdown** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **nix** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **perl** | ✅ | ❌ | ❌ | — |
| **php** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **prisma** | ✅ | ✅ | ✅ | definitions, locals, references |
| **proto** | ✅ | ✅ | ✅ | definitions, locals, references |
| **python** | ✅ | ✅ | ✅ | definitions, locals, references |
| **query** | ✅ | ✅ | ✅ | definitions, locals, references |
| **r** | ✅ | ❌ | ❌ | — |
| **regex** | ✅ | ✅ | ✅ | definitions, locals, references |
| **ruby** | ✅ | ✅ | ✅ | definitions, locals, references |
| **rust** | ✅ | ✅ | ✅ | definitions, locals, references |
| **scss** | ✅ | ✅ | ✅ | definitions, locals, references |
| **sql** | ✅ | ✅ | ✅ | definitions, locals, references |
| **svelte** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **swift** | ✅ | ✅ | ✅ | definitions, locals, references |
| **toml** | ✅ | ✅ | ✅ | definitions, locals, references |
| **tsx** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **typescript** | ✅ | ✅ | ✅ | definitions, locals, references |
| **vue** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **xml** | ✅ | ✅ | ✅ | definitions, injections, locals, references |
| **yaml** | ✅ | ✅ | ✅ | definitions, locals, references |

---

## Gaps & Anomalies

### 1. WASM grammars with NO query coverage

These 7 languages can parse but cannot be queried for definitions, references, or tags:

| Language | WASM file | Impact |
|---|---|---|
| cmake | tree-sitter-cmake.wasm | Parse only — no symbol extraction |
| dart | tree-sitter-dart.wasm | Parse only — no symbol extraction |
| elixir | tree-sitter-elixir.wasm | Parse only — no symbol extraction |
| ini | tree-sitter-ini.wasm | Parse only — no symbol extraction |
| make | tree-sitter-make.wasm | Parse only — no symbol extraction |
| perl | tree-sitter-perl.wasm | Parse only — no symbol extraction |
| r | tree-sitter-r.wasm | Parse only — no symbol extraction |

### 2. Query entries with no corresponding WASM

**None.** Every query directory and flat `*-tags.scm` has a matching WASM.

### 3. C# naming duplication (critical inconsistency)

Two distinct name keys exist for the same language:

| Key | WASM | flat-tags.scm | query-dir |
|---|---|---|---|
| `c_sharp` | tree-sitter-c_sharp.wasm | c_sharp-tags.scm | c_sharp/ |
| `csharp` | tree-sitter-csharp.wasm | csharp-tags.scm | csharp/ |

Both sets are fully present and internally consistent. Any language-dispatch logic must explicitly handle this or it will double-register or silently miss one variant. See integration audit for which key the code actually uses.

### 4. Stray files at `grammars/` root

| File | Issue |
|---|---|
| `grammars/tree-sitter-javascript.wasm` | Duplicate of `grammars/grammars/tree-sitter-javascript.wasm` — two copies, potential path confusion |
| `grammars/tree-sitter.wasm` | Core tree-sitter runtime — not a language grammar, must not be treated as one |

### 5. Languages missing `injections.scm`

Languages **with** `injections.scm` in their query directory (13):
`bash`, `css`, `dockerfile`, `hcl`, `html`, `javascript`, `markdown`, `nix`, `php`, `svelte`, `tsx`, `vue`, `xml`

Languages **without** `injections.scm` (may embed other languages but cannot declare it):
`c`, `c_sharp`, `cpp`, `csharp`, `go`, `graphql`, `java`, `json`, `kotlin`, `lua`, `prisma`, `proto`, `python`, `query`, `regex`, `ruby`, `rust`, `scss`, `sql`, `swift`, `toml`, `typescript`, `yaml`

---

## Counts

| Metric | Count |
|---|---|
| Total WASM files in `grammars/grammars/` | 43 |
| WASM-only (zero query coverage) | 7 |
| Languages with full coverage (WASM + flat-tags + query-dir) | 36 |
| Query subdirectories | 36 |
| Flat `*-tags.scm` files | 36 |
| Languages with `injections.scm` in query-dir | 13 |
| Duplicate C# name keys | 2 (`c_sharp`, `csharp`) |
| Stray files at grammars/ root | 2 |
