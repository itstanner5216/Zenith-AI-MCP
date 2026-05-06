# Documentation Review: Pair update2

## Files Reviewed
- `README.md` (555 lines)
- `ARCHITECTURE.md` (876 lines)
- `CLAUDE.md` (195 lines)

## Overall Rating: 2/4 — Strong Architecture, Weak Pitch, Needs Sales

### Summary
This is a technically sound documentation set that fails to sell the project. The README reads like a reference manual for someone who already bought in, not a compelling introduction for someone deciding whether to use it. The architecture is well-documented, but the "why" is buried under "what." This is a missed opportunity for a tool that genuinely does more than its competitors.

---

### README.md — The Problem

#### What's Here (Correct)
- Accurate tool-by-tool parameter reference
- Correct env var table
- Valid quick-start commands
- Clean project structure diagram
- Environment variable and adapter configuration sections

#### What's Missing (Critical)
- **No hook.** The opening tagline is generic: *"The MCP filesystem server built for serious AI-assisted development."* Compare to what this thing actually does: it detects when your refactor diverges from the common pattern and forces you to acknowledge it before it lets you continue. It rolls back symbol edits to any point in time. It finds structurally similar functions across a 50,000-file repo. The README buries these superpowers under dry parameter lists.

- **No "before vs after" for the developer.** The comparison table exists, but it compares *features*, not *pain relief*. If you have ever applied a refactor to 12 files and only realized 3 files later that one of them had a subtly different signature, you already want Zenith. The README never puts you in that seat.

- **No proof of work.** Every claimed capability (BM25, AST parsing, structural similarity) is asserted, not demonstrated. Show the query. Show the result. Show the diff that caught the outlier.

- **No journey.** The "What the code actually does" section is accurate but reads like a changelog. There is no narrative: here is a problem (cross-file refactoring is terrifying), here is how Zenith solves it (impact graph + outlier detection + atomic apply), here is what that feels like (you edit the diff, Zenith flags the weird one, you acknowledge it, everything works).

- **`loadDiff` is the heart of refactor_batch — call it that.** The tool mode is `loadDiff`, but the README should explain the *concept*, not just the enum value. It builds a diff for you. You edit it. You send it back. That is not a "mode." That is a workflow.

- **`stashRestore` should not be described as "retry failed edits."** It is the recovery and rebuild mechanic of a system that acknowledges edits fail because codebases are messy. Sell the trustworthiness, not the failure path.

- **Missing: why the retrieval pipeline matters.** A one-liner about "dynamic tool filtering" does not explain why someone managing 8 MCP servers would care.

- **Missing: the toon compression library as a selling point.** In-process, zero-dependency structured compression is not "optional compression." It is the reason you can read a 10,000-line file and not blow your context window. Sell that.

- **Missing: the security model as a reason to trust it.** Per-session isolation, symlink re-checking, and sensitive-file blocking are not just "security features." They are the reason you can run this on a production checkout without fear. The README lists them; it does not argue them.

#### Recommended Rewrite Strategy
1. Move the comparison table above the fold. Make it the first thing after the tagline.
2. Replace "What the code actually does" with a narrative: problem → Zenith's approach → result.
3. Add a highlighted example or two. A short before/after for a symbol-mode edit, a structural search result, or a refactor_batch workflow.
4. Make the "why no fallback?" box scarier and more specific. Turn it from an explanation into a principle.
5. Lead each tool section with the problem it solves, then the parameters.
6. Add a "When to use what" decision tree.
7. Make `loadDiff` a hero. It is the most distinctive workflow in the whole toolset.

#### Verdict: Correct but Uninspiring
Everything is factually right. Nothing makes you *want* to install it.

---

### ARCHITECTURE.md — The Strength

This is where the set earns its rating. It is genuinely good.

#### What Works
- **Module map is precise.** Every core module, its file path, and its single-sentence responsibility. No ambiguity.
- **Security model is thorough.** Four distinct layers (path validation, sensitive file blocking, exclusive writes, per-session isolation) are each explained with the exact mechanism, not just the concept.
- **Edit engine explanation is code-level accurate.** Three matching strategies, in-memory validation, atomic commit, temp-file rename. This matches the source exactly.
- **Stash system has correct mechanics.** 120s TTL, 2-attempt limit, rehydration behavior.
- **Tool deep dives match source.** Every mode, every parameter, every edge case. The `refactor_batch` section is especially strong — outlier detection, char budget, retry locking.
- **Adapter system is complete.** All 16 platforms, config formats, registry behavior, CLI flags.
- **Retrieval pipeline module tree is exhaustive.** Every file in `src/retrieval/` is mapped to its purpose.
- **Response discipline section is a genuine policy document.** It reads like it came from the same person who wrote the tool, because it did.

#### What Could Be Stronger
- **Entry point flow diagrams are static text.** A small ASCII flow would make the stdio vs HTTP lifecycle difference clearer.
- **No performance expectations.** BM25 numbers (top-100 from 50,000 files in X ms) would ground the claims.
- **No extension guide.** "Adding a tool" is listed, but there is no walkthrough of what a new tool file actually looks like — importing types, using zod, calling `ctx.validatePath()`.

#### Verdict: Reference-Grade
If you are already committed to using or contributing to Zenith, this is what you want. It assumes you care, and it rewards that care with depth.

---

### CLAUDE.md — The Right Balance

- Preserves all original response discipline rules without dilution
- Includes the architecture overview without the 876-line noise
- Tool catalog is a genuine quick-reference, not a copy-paste
- Code snippets are real, compilable, and use the correct import paths (`../core/tree-sitter.js`, not `./tree-sitter`)
- Developer cheat sheet is genuinely useful for adding a tool or configuring an adapter

#### Verdict: Excellent
It knows its audience (a coding assistant) and gives exactly what it needs: enough context to be productive, none of the fluff.

---

### Final Verdict

This pair is **technically the strongest** but **commercially the weakest**. If you merged its factual accuracy with a README that tells a story about *why* these features matter — the fear of breaking 12 files with a refactor, the pain of grepping for definition sites, the context window death spiral of reading large files — it would be the best of both worlds.

**Recommendation:** Keep ARCHITECTURE.md and CLAUDE.md as-is. Rewrite README.md with a narrative-first, pain-point-driven approach. The current version is a reference. It needs to be a pitch.

---
*This review was conducted against the actual source code at `fe20eab` — every module path, tool name, and parameter was verified against `src/`.*
