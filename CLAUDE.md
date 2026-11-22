# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project-specific instructions

FAST-NUCES CS-2001 Data Structures Lab (Fall 2026): HFT matching engine + real-time AML graph analytics.

## Layout
- `engine/` C++17 core. `include/ds.h` = all custom data structures, `src/engine.cpp` = the 5 layers, `src/sim.cpp` = the in-engine market simulator, `src/main.cpp` = stdin/stdout line protocol, `tests/` = unit tests.
- `backend/` Node bridge (Express + `ws`) that spawns the engine binary. No business logic here.
- `frontend/` Next.js 14 dashboard (Tailwind). No business logic here either.

## Hard rules
- The engine core must not use `std::vector`, `std::map`, `std::unordered_map`, `std::queue`, `std::priority_queue` or `std::list`. Use the structures in `ds.h` (grading focuses on DSA implementation and execution time). `std::string` is allowed only for building JSON output.
- Any new data structure goes in `ds.h` with its Big-O in a one-line comment and a test in `tests/test_engine.cpp`.
- All money is integer cents. Tunable thresholds live at the top of `engine/include/engine.h`.
- The engine and the Node bridge talk only through the line protocol documented at the top of `engine/src/main.cpp`. If you add a command, update that comment, `main.cpp`, and a test.
- Ask before changing the architecture (e.g. switching to an N-API addon).

## Verify before saying "done"
1. `make -C engine test` (builds with ASan/UBSan, must print `0 failed`)
2. `make -C engine && npm test -w backend`
3. `npm run build -w frontend`
