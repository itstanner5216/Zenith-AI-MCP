# Tool Schema Migration Notes

## Symbol Versioning Migration (May 2026)

During a recent architectural shift, the responsibility for symbol-level version history and rollback was migrated out of the `stashRestore` tool and into the `refactor_batch` tool.

This note serves as a record of the schema changes, as this migration previously caused documentation drift where documentation (like `README.md` and `ARCHITECTURE.md`) was incorrectly suggesting that `stashRestore` handled point-in-time symbol rollbacks.

### The Problem

Previously, `stashRestore` handled two distinct concepts:
1. **Stash Management:** Retrying failed, atomic file writes (`apply`) or clearing failed writes from the SQLite DB.
2. **Symbol Versioning:** Managing the version history of a specific AST symbol and rolling back its content (`restore symbol:"AuthService.login"`).

This resulted in overloaded and confusing modes. 

### The Solution: Migration to `refactor_batch`

Symbol versioning is now strictly tied to symbol-level code alterations, which is the domain of `refactor_batch`.

#### Changes to `stashRestore`

`stashRestore` is now **exclusively for stash management**. 

- `apply`: Retry a stashed edit/write using its `stashId`.
- `restore`: **Clears** a stash entry by `stashId`. (It no longer restores symbol versions).
- `list`: Browse current stash entries.
- `read`: Inspect a specific stash entry.
- *Parameters removed:* `symbol`, `version`, `init`, `history`.

#### Changes to `refactor_batch`

`refactor_batch` now handles all symbol-level snapshotting and point-in-time rollbacks.

- `history`: View the available SQLite snapshots for a specific `symbol` (and optional `fileScope`).
- `restore`: Rollback a `target` (symbol name) to a previous `version` snapshot, utilizing AST parsing to replace the symbol block.
- *Parameters added:* `symbol` (or `target` depending on the mode) and `version`.

### Documentation

If updating tool documentation, refer to:
- `src/tools/stash_restore.ts` — Look at `inputSchema` to confirm its narrow scope.
- `src/tools/refactor_batch.ts` — Look at the `restore` and `history` modes in the `inputSchema`.
