# Zenith-MCP Tool Schema Anomalies & Deep Dive

This document details the architectural quirks, misalignments, and undocumented behaviors of the various tools in the Zenith-MCP codebase, discovered during a comprehensive codebase review in May 2026. 

## 1. `directory` (Directory Exploration)
**Quirk:** Mismatched parameters for `list` vs `tree` modes.
The tool uses a unified schema, which means all parameters are accessible regardless of the chosen `mode`. However:
- `excludePatterns` is **only** passed to `buildTree()` and is completely ignored by `listRecursive()` if `mode === "list"`.
- `showSymbols` and `showSymbolNames` are also only implemented for the `tree` mode and are silently ignored during `list`.

*Implication:* Agents or users may attempt to filter a `list` response using `excludePatterns` and find it unresponsive.

## 2. `search_files` vs `search_file`
**Quirk:** Intentional redundancy and implicit fallback modes.
- `search_file` acts as a highly optimized, flat-schema tool explicitly for single files (handling single-file `grep` and `symbol` operations). It has no `mode` parameter.
- `search_files` is the heavy-duty, multi-file counterpart. 
- *Undocumented Code Structure:* Inside `src/tools/search_files.ts`, there is no explicit `if (args.mode === "content")` block. Instead, `content` is treated as the catch-all fallback block at the bottom of the file after `symbol`, `structural`, `definition`, and `files` modes have returned. 

## 4. `stashRestore` (Stash Management)
**Quirk:** Bleed-over between `file` and `newPath` parameters.
In the schema, `file` is described strictly for `list`/`read`/`restore` filters:
> `file: z.string().optional().describe("list/read/restore: filter by file path.")`

However, in the `apply` mode implementation (which retries a failed edit/write), the code falls back to `file` if `newPath` is not provided:
> `const entry = getStashEntry(ctx, args.stashId, args.newPath || args.file);`

*Implication:* An agent passing `file` instead of `newPath` during an `apply` operation might unintentionally redirect a write operation.

## 5. `read_file` vs `read_multiple_files`
**Quirk:** Divergent schema paradigms.
- `read_file` is completely flat, utilizing auto-detection based on the presence of parameters like `head`, `tail`, `offset`, or `ranges`.
- `read_multiple_files` is purely for concurrent multi-file fetching, but enforces dynamic `CHAR_BUDGET` balancing, dropping parameters like `head`/`tail` entirely in favor of an automated `maxCharsPerFile`.

## Summary
The codebase utilizes highly granular tools, but occasionally suffers from unified-schema bloat where parameters are exposed to modes that do not implement them (e.g., `directory`). It is highly recommended to strictly follow the annotated parameter guidelines to avoid silent failures.