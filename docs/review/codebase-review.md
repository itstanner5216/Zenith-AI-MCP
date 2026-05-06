---

## Findings

### [P1] Mathematical error in sigmoid Padé approximant
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/toon/sagerank.ts` |
| **Lines** | 26–32 |
| **Priority** | 1 |
| **Confidence** | 1.0 |

The `_fastSigmoid` function claims to be a Padé rational approximation for `1/(1+e^-x)`, but computes `(x^3 + 6x + 12) / (x^3 + 12x + 48)`. This formula is mathematically incorrect and maps `0` to `0.25` instead of `0.5`, leading to error margins > 0.4. It appears to be a botched translation of `(x^2 + 6x + 12) / (2x^2 + 24)`. Given this is used for TF saturation and entropy probability calculation, it significantly skews ranking scores. It would be much more effective and accurate to use native `1 / (1 + Math.exp(-x))`.

---

### [P1] Mathematical error in sigmoid Padé approximant
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/toon/bmx-plus.ts` |
| **Lines** | 37–43 |
| **Priority** | 1 |
| **Confidence** | 1.0 |

Identical to the issue in `sagerank.ts`, the `_fastSigmoid` function implements a broken Padé rational approximation for the sigmoid function. The implementation yields `0.25` at `x=0` instead of `0.5` and has major deviations from the true sigmoid curve. Using V8's highly optimized native `1 / (1 + Math.exp(-x))` would be simpler, faster, and actually correct.

---

### [P1] Ignoring isolated allowedDirectories in validation check
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/core/lib.ts` |
| **Lines** | 350–359 |
| **Priority** | 1 |
| **Confidence** | 0.95 |

The `searchFilesWithValidation` function takes `allowedDirectories` as an explicit parameter for context isolation, but completely ignores it in its try-catch block, instead calling the globally bound `validatePath(fullPath)` API. This breaks session isolation logic because it relies on the global configuration rather than the directories explicitly provided to the search function. 

---

### [P3] Unused trimmedLen parameter in coordinate mapping
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/core/edit-engine.ts` |
| **Lines** | 133–141 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The `mapTrimmedIndex` function accepts a `trimmedLen` parameter but never uses it. The function accurately calculates the starting coordinate (`origIdx`), but relying on the caller to compute the length mapping is unnecessary if `trimmedLen` was originally intended to verify or map the span's end index. The parameter should be removed.

---

### [P3] Unused imports and unused iteration variables
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/retrieval/telemetry/tokens.ts` |
| **Lines** | 1–1 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The file imports `RootEvidence` and `WorkspaceEvidence` but never uses them. Additionally, on line 106, the loop declares `[familyKey, familyTokens]` but only reads `familyTokens`, leaving `familyKey` unused. These should be cleaned up.

---

### [P3] Dead code functions in symbol-index
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/core/symbol-index.ts` |
| **Lines** | 174–182 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The internal functions `pruneOldVersions` and `defaultVersionTtlMs` are declared but never called anywhere in the file. Since these are private to the module and unexported, they are completely dead code and should be removed to avoid confusion.

---

### [P3] Unused imported functions in project context
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/core/project-context.ts` |
| **Lines** | 5–5 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The file imports `findRepoRoot` from `./symbol-index.js` but never actually uses it anywhere within `project-context.ts`.

---

### [P3] Unused Tool interface import
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/retrieval/base.ts` |
| **Lines** | 4–4 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The abstract base class imports `Tool` from `@modelcontextprotocol/sdk/types.js` but the type is never utilized in the class signature or body.

---

### [P3] Unused args parameter in router evaluation
| Field | Value |
|:---|:---|
| **File** | `/home/tanner/Projects/Zenith-MCP/src/retrieval/routing-tool.ts` |
| **Lines** | 75–75 |
| **Priority** | 3 |
| **Confidence** | 1.0 |

The `handleRoutingCall` function takes an `args` parameter in its signature but intentionally disregards it because the router simply returns a proxy string without invoking the target tool. The parameter should be removed or prefixed with an underscore (`_args`) to signal intentional non-use.

---

## Overall Assessment

| Field | Value |
|:---|:---|
| **Verdict** | `patch is incorrect` |
| **Confidence** | 1.0 |

While the TypeScript conversion looks structurally sound, the porting of the math functions in Zenith-Toon introduced severe calculation bugs (Padé approximant), and there is a critical isolation bypass in the core filesystem search utilities. These issues along with several unused definitions must be addressed before this refactor can be deemed production-ready.
