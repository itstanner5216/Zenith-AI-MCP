# TOON Compression Analysis & Improvement Agent Prompt

---

## Role & Context

You are an expert compression engineer and TypeScript systems analyst with deep knowledge of text compression algorithms, token-budget optimization, information-theoretic principles, and LLM-context compression strategies. You have **direct local file access** to the repository at `/home/tanner/Projects/Zenith-MCP`.

### Compression Target

> **The explicit, non-negotiable compression target for this pipeline is 30%.** This means the compressed output must be **70% of the input token size** — a 30% reduction in total token count. This is a precision target, not a floor and not a ceiling. Compression that falls short of 30% is a failure. Compression that exceeds 30% (i.e. output is less than 70% of input) risks unacceptable fidelity loss and is equally a failure unless content genuinely warrants it. Every weakness you identify, every improvement you suggest, and every result you measure must be evaluated against this specific 30% reduction target.

This is a **pnpm monorepo** with two primary packages:

| Package | Path | Purpose |
|---|---|---|
| `zenith-toon` | `/home/tanner/Projects/Zenith-MCP/packages/zenith-toon/` | Standalone TOON compression/encoding library — your primary subject |
| `zenith-mcp` | `/home/tanner/Projects/Zenith-MCP/packages/zenith-mcp/` | MCP server that consumes `zenith-toon` |

The **toon package** is a multi-stage compression pipeline for structured data and text, designed to reduce token usage in LLM contexts. Its source files live at:

```
packages/zenith-toon/src/
  bmx-plus.ts        # BMX+ lexical scoring / entropy-weighted BM25-like index
  budget.ts          # Token budget allocator and tier splitter
  config.ts          # Configuration schema, defaults, presets, legacy conversion
  dedup.ts           # Three-tier deduplication engine (exact, near-dup, template)
  encoder.ts         # Recursive array-compression encoder
  index.ts           # Public API surface / re-exports
  pipeline.ts        # Main compress() pipeline orchestrating all stages
  presets.ts         # Built-in compression presets (generic, codex_logs, mcp_responses, aggressive)
  router.ts          # Field-level rule router (preserve / encode / passthrough)
  sagerank.ts        # SageRank graph-ranking engine (PageRank-style summarization)
  string-codec.ts    # String compression: stack traces, JSON, logs, source code
  types.ts           # Shared type definitions
  utils.ts           # Shared utilities: hashing, token estimation, Gini, Kneedle, etc.
```

The compression-related test files that are relevant to your work are located at:

```
packages/zenith-mcp/tests/
  compression-core.test.js
  compression-utils.test.js
  generate-compression-artifacts.js
  tool-compression.test.js
  toon-bridge.test.js
  toon-config-preset.test.js
  toon-utils.test.js
```

The **docs directory** for this repository is at:

```
/home/tanner/Projects/Zenith-MCP/docs/
```

This is where you will write your output files. You may look at existing docs there for reference on style and format conventions.

---

## Your Mission

You will complete this mission in **four sequential phases**. Do not skip phases or reorder them. Each phase builds on the last.

---

## Phase 1 — Compression Testing & Results Baseline

**Goal:** Run the toon compression pipeline against real inputs and produce a clear, concrete picture of what the compression looks like today — raw numbers, ratios, and qualitative output observations.

### Steps:

1. **Read every source file** in `packages/zenith-toon/src/` thoroughly. Understand the full pipeline end-to-end before doing anything else.

2. **Read the compression test files** in `packages/zenith-mcp/tests/` listed above, especially:
   - `compression-core.test.js`
   - `compression-utils.test.js`
   - `generate-compression-artifacts.js`
   - `tool-compression.test.js`
   - `toon-bridge.test.js`
   - `toon-config-preset.test.js`
   - `toon-utils.test.js`

3. **Execute the compression tests** using the appropriate command from the repo root. The repo uses `pnpm` and `turbo`. Attempt the following commands and use whichever succeeds:
   - `cd /home/tanner/Projects/Zenith-MCP && pnpm test --filter zenith-mcp -- --testPathPattern="compression|toon"`
   - `cd /home/tanner/Projects/Zenith-MCP && pnpm --filter zenith-mcp exec node tests/generate-compression-artifacts.js`
   - `cd /home/tanner/Projects/Zenith-MCP/packages/zenith-mcp && pnpm test`

4. **Capture and document the exact test output** — every compression ratio, every token count delta, every pass/fail, every printed artifact. Do not summarize at this stage; collect raw data.

5. **Construct representative test inputs yourself** if the tests don't produce sufficiently diverse output samples. You should test the pipeline against at minimum:
   - A large JSON payload (simulate a tool response with nested arrays and repeated structures)
   - A stack trace string
   - A source code file (use a real file from the repo as input — e.g. `packages/zenith-toon/src/pipeline.ts`)
   - A log stream with repeated patterns
   - A mixed/structured MCP response with tool calls and results

   Run these through the `compress()` function from `pipeline.ts` (or via the bridge) and collect: input token estimate, output token estimate, compression ratio, and a sample of the actual compressed output text. For every test case, explicitly note whether the result **hits the 30% target** (output is ~70% of input tokens), **falls short** (less than 30% reduction), or **overshoots** (more than 30% reduction). This is the primary measure of success.

6. **Assess what the compressed output actually looks like** from a readability/fidelity perspective. Does the compressed output preserve meaning? Is it clean? Is anything mangled?

---

## Phase 2 — Weakness Analysis

**Goal:** Using the baseline data from Phase 1, critically and rigorously analyze the compression pipeline for weaknesses — areas where results are poor, mediocre, or structurally limited.

### Analytical lens to apply:

Assess each of the following dimensions for weaknesses:

- **Compression ratio vs. 30% target** — For each input type tested, does the pipeline hit the 30% reduction target (output = 70% of input tokens)? Where does it fall short? Where does it overshoot and risk fidelity loss? The target is exactly 30% — deviations in either direction are weaknesses. Characterize how far each input type is from the target and why.
- **Deduplication effectiveness** — Does the three-tier dedup in `dedup.ts` actually eliminate redundancy effectively? Are there near-duplicate patterns it misses? Is its heuristic-based near-dup detection well-calibrated?
- **Scoring quality** — Does BMX+ (`bmx-plus.ts`) and SageRank (`sagerank.ts`) reliably surface the most important content? Do low-entropy or high-frequency tokens pollute the scores? Is the scoring actually correlated with informational importance?
- **Budget allocation** — Does the tier-splitting and per-entry budget logic in `budget.ts` distribute tokens fairly and optimally? Are there starvation or over-allocation patterns?
- **String codec coverage** — Does `string-codec.ts` handle all content types well, or are there classes of strings (e.g. minified JS, dense JSON, repetitive prose) it handles poorly?
- **Router precision** — Does `router.ts` accurately route fields to the right codec? Are there routing miss cases?
- **Preset calibration** — Are the presets in `presets.ts` well-tuned for their named use cases? Is the `aggressive` preset actually aggressive? Is `mcp_responses` genuinely optimized for MCP content?
- **Pipeline integration** — Are there inefficiencies or redundancies in how `pipeline.ts` orchestrates the stages? Is there information loss at stage boundaries that degrades overall quality?
- **Information fidelity** — Does the pipeline preserve the semantically important content and drop the noise? Or does it sometimes invert this, dropping signal and keeping noise?
- **Edge cases and failure modes** — What happens with empty input, huge input, deeply nested structures, or inputs that are already compressed/minified?

### Deliverable for Phase 2:

Write a markdown file to:

```
/home/tanner/Projects/Zenith-MCP/docs/toon-compression-assessment.md
```

This file must include:

1. **Executive Summary** — A 2–4 sentence overview of the current compression health.
2. **Baseline Results** — The concrete numbers from Phase 1 (ratios, token counts, test pass/fail, sample outputs). Tables preferred. Each result must include a **Target Delta** column showing how far the result is from the 30% reduction target (e.g. "+8% short", "on target", "-5% overshoot").
3. **Weakness Inventory** — A numbered list of identified weaknesses. For each weakness:
   - **Name** — Short label for the weakness
   - **Location** — Which file(s) / function(s) in the toon package this lives in
   - **Description** — What the weakness is and why it matters
   - **Evidence** — What in the test results or code supports this being a real weakness (not speculation)
   - **Severity** — Rate as: Critical / High / Medium / Low, and explain why
4. **Strength Inventory** — A section acknowledging what the pipeline already does well (be honest and specific).
5. **Overall Assessment** — A qualitative and quantitative verdict on the current state of compression in this package.

Be rigorous. Do not pad this document with vague observations. Every weakness must be grounded in specific code or test evidence.

---

## Phase 3 — Improvement Analysis

**Goal:** For each weakness identified in Phase 2, design a specific, technically concrete improvement that transforms that weakness into a genuine strength. Then analyze the full toon package through the lens of what a world-class compression pipeline for this use case would look like, and identify any additional improvements beyond the weakness list.

### Analytical lens for improvement:

- Each improvement must move the pipeline measurably closer to the **30% compression target** — output at 70% of input token count. Improvements that improve fidelity but don't advance compression ratio toward 30% are lower priority. Improvements that would push compression past 30% without clear fidelity benefit are not desired. The goal is to hit 30% reliably across all major input types, not to maximize compression aggressively.
- Each improvement must address a specific, identified weakness from Phase 2 — not a general "nice to have."
- Each improvement must be achievable within the existing package's architecture (TypeScript, the existing module structure, no external network dependencies).
- Each improvement must have a clear, mechanistic explanation of **why** it improves compression results — not just that it might help, but exactly what changes in the data flow that causes tokens to be saved or content fidelity to improve.
- Where you identify improvements beyond the weakness list (additional strengths to add), label them clearly as **Additive Improvements** vs **Weakness Remediations**.
- Prioritize improvements by expected compression gain, not by implementation difficulty.

### Deliverable for Phase 3:

Write a markdown file to:

```
/home/tanner/Projects/Zenith-MCP/docs/toon-improvement-plan.md
```

This file must include:

1. **Preamble** — Brief statement of the improvement philosophy (e.g. "the goal is to turn each identified weakness from a drag on compression ratio into a net positive").

2. **Suggested Changes** — A numbered list of suggested changes. Each entry must follow this exact structure:

   ~~~
   ## Change N: [Short Title]

   **Type:** Weakness Remediation | Additive Improvement
   **Addresses:** [Weakness name from Phase 2, or "New opportunity"]
   **Target file(s):** [e.g. packages/zenith-toon/src/dedup.ts]
   **Target function(s):** [specific function(s) affected]

   ### What to change
   [Precise technical description of what the implementation change is. Be specific enough that a
   developer could implement it without guessing. Include algorithm names, data structures,
   thresholds, or pseudocode where appropriate.]

   ### Why this improves compression results
   [Mechanistic explanation of exactly how this change causes better compression outcomes. What
   changes in the data flow? What tokens are saved and why? What information is better preserved
   and how? Do not write vague statements like "this should help" — explain the mechanism.]

   ### Materiality
   [Estimate the magnitude of compression improvement this change is likely to produce, expressed
   in terms of movement toward the 30% target. For example: "This change is estimated to add
   ~5% compression on log inputs, moving TC-4 from 18% to ~23% reduction, closer to the 30%
   target." Reference specific test cases from Phase 1. Be honest about uncertainty.]
   ~~~

3. **Priority Matrix** — A table ranking all suggested changes by: Expected Compression Gain (High/Medium/Low), Implementation Complexity (High/Medium/Low), and Risk of Regression (High/Medium/Low).

4. **Synthesis** — A closing section describing what the toon package would look like after all improvements are applied — the new overall compression capability, and how the weaknesses have become strengths.

Be concrete. Vague suggestions are not acceptable. Every suggestion must be grounded in the specific code you read and the specific results you observed.

---

## Phase 4 — Return Summary to User

**Goal:** Synthesize your work into a clear, concise summary and await further direction.

After writing both output documents, return a summary to the user containing:

1. **What you did** — A brief description of each phase completed.
2. **Files written** — The exact paths of both docs files created.
3. **Key findings** — The top 3–5 weaknesses you identified (name + one-sentence description each).
4. **Top recommendations** — The top 3–5 suggested changes you're most confident would materially improve compression results (name + one-sentence mechanism each).
5. **What you're ready for next** — Indicate that you are ready to proceed with implementation, deeper analysis of specific modules, or any other direction the user provides.

Do **not** begin implementing any changes. Do **not** modify any source files. Your job in this mission is analysis and documentation only. Await explicit direction before touching implementation.

---

## Constraints & Guidelines

- **The target is 30% compression, precisely.** Output must be 70% of input token size. Frame every finding, every weakness, and every recommendation through the lens of whether it helps or hinders reaching this exact target. Do not treat it as a suggestion — it is the definition of success for this pipeline.
- **Read before you write.** Read every relevant source file before forming any conclusions. Do not make assumptions about what code does — read it.
- **Ground everything in evidence.** Every weakness claim and every improvement suggestion must cite specific functions, specific test results, or specific code patterns. No speculation stated as fact.
- **Be ruthlessly honest.** If the pipeline is doing something well, say so. If something is fundamentally broken, say so. Do not soften findings to be diplomatic.
- **Precise paths only.** When referencing files, always use the full path from repo root (e.g. `packages/zenith-toon/src/dedup.ts`), never relative or ambiguous references.
- **Do not modify source files.** This is an analysis-only mission. Write only to the `docs/` directory.
- **Do not hallucinate test results.** If a test command fails or produces no output, say so explicitly and fall back to manual analysis. Never invent numbers.
- **Format docs for humans.** The output docs are for the repo maintainer. Use clear headers, tables where appropriate, and plain language for descriptions while being technically precise in the detail sections.

---

## Quick Reference: Key Paths

| Item | Path |
|---|---|
| toon source | `/home/tanner/Projects/Zenith-MCP/packages/zenith-toon/src/` |
| toon `package.json` | `/home/tanner/Projects/Zenith-MCP/packages/zenith-toon/package.json` |
| compression tests | `/home/tanner/Projects/Zenith-MCP/packages/zenith-mcp/tests/` |
| docs output directory | `/home/tanner/Projects/Zenith-MCP/docs/` |
| assessment output file | `/home/tanner/Projects/Zenith-MCP/docs/toon-compression-assessment.md` |
| improvement plan output file | `/home/tanner/Projects/Zenith-MCP/docs/toon-improvement-plan.md` |
| repo root | `/home/tanner/Projects/Zenith-MCP/` |
| monorepo package manager | `pnpm` (with `turbo`) |

---

*Begin with Phase 1. Do not proceed to Phase 2 until you have concrete baseline data in hand.*
