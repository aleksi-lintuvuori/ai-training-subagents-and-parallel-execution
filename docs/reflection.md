# Reflection: subagents and parallel execution

## 1. Which tasks ran in parallel, and which were sequential? Was the grouping what I expected?

**Sequential (done by the main session, no subagents):**
- **Phase 1, Steps 1–2:** the report types in both `types.ts` files and `calculateMonthlyReport` in `backend/src/utils/report.ts`. Claude Code wrote these itself before spawning anything. Everything in Phase 2 depended on them, and they were small enough that a subagent would have cost more than it saved.
- **Phase 3, Step 7:** final verification. Claude ran it once all agents had reported back: `tsc --noEmit` in both packages, `npm test`, starting the dev servers, calling the endpoints, and loading the page in headless Chromium.

**Parallel (three subagents spawned within about 20 seconds of each other):**
- **Agent A:** Steps 3 **and** 4 together, the JSON endpoint and the CSV export in `backend/src/routes/reports.ts`, plus the route registration in `index.ts`.
- **Agent B:** Step 5, `ReportView.tsx` and wiring it into `App.tsx`.
- **Agent C:** Step 6, unit tests for `calculateMonthlyReport`.

**Was it what I expected?** Mostly yes, with two differences from how I had labelled the plan:
- In the version I pasted, Steps 1 and 2 were marked "(parallel)". Claude ran them sequentially and did them itself, which was the right call: the helper imports the types, so they are not truly independent.
- I had labelled Step 6 "after previous steps". Claude ran it in parallel with Phase 2, because the tests only need `calculateMonthlyReport`, which already existed after Phase 1. That was a sharper dependency analysis than mine. Step 6 depends on Step 2, not on Steps 3–5.

Claude reasoned from the actual data dependencies (which file imports what) rather than from the labels in the plan. That is the main lesson for me: the labels I write in a plan are hints, and the real dependency graph comes from the files.

## 2. How did Claude Code handle Steps 3 and 4 sharing a file? Did I have to intervene?

Claude spotted that Steps 3 and 4 both write `backend/src/routes/reports.ts` and gave them to **a single agent (Agent A)**, even though I had marked both "(parallel)". So there was no write conflict to reconcile and no need for git worktrees.

The single agent also made a good structural choice. It put the CSV formatting (`toReportCsv` and a CSV escaping helper) in `utils/report.ts` and kept the route handlers free of logic, as `CLAUDE.md` requires. Two separate agents working on one file would likely have duplicated the month validation and might have put CSV building inline in the route.

**I did not have to intervene.** The only cleanup came later, when the code review found the month validation duplicated across the two handlers. That was fixed by moving it into one shared helper in `report.ts`.

## 3. What did the code review agent catch that I would not have noticed without it?

I ran three `code-reviewer` agents in parallel, one per file. All three returned "Request changes", but none found anything critical. Findings I would most likely have missed on my own:

- **CSV formula injection:** a category name that starts with `=`, `+`, `-` or `@` runs as a formula when the export is opened in Excel or Sheets. The CSV escaping followed the CSV standard (RFC 4180), so the code looked correct, and I would not have thought about spreadsheet formulas.
- **Floating-point money:** amounts were summed as floats, so `0.1 + 0.2` produced `0.30000000000000004` in the JSON and the CSV. That can also mark a row "Over budget" while it displays €0.30 of €0.30. Fixed by summing in whole cents.
- **Boundary state:** spending exactly the limit showed "Under budget" with €0.00 remaining. This led to a third "At limit" state.
- **"Total spent" left out uncategorised expenses,** so the report total could differ from the total under the expense list.
- **Stale data on month change:** the new month's heading appeared above the old month's figures, and a failed background refresh replaced a valid table with an error.
- **Test gaps:** there were no HTTP-level tests for either endpoint (400 responses, CSV headers, CSV body) and no tests for `toReportCsv`. Agent C's unit tests looked thorough, so I would have assumed the feature was covered.
- **Problems outside this feature:** `expenses.ts` accepts dates that aren't strings and `Infinity` amounts, either of which can make the report return a 500. `categories.ts` calculates monthly spending inline using the UTC month, which breaks the "logic lives in utils" rule and can make the Budget table and the report disagree just after midnight on the 1st. These have not been fixed yet.

After the fixes there were 82 backend tests (up from 47) and 4 Playwright tests, and everything passed.

## 4. Which Module 9 workflow steps would I turn into pre-defined agents for the team?

1. **`code-reviewer`** (already created in `.claude/agents/code-reviewer.md`). It earned its place here. The next improvement is to build the `CLAUDE.md` rules into it: no `any`, calculation logic only in `utils/`, don't change existing expense and category fields, and check `types.ts` before adding new types.
2. **`test-writer`:** writes Vitest unit tests and HTTP route tests following the existing pattern (reset the stores in `beforeEach`, seed through `categoryStore.create()` and `expenseStore.create()`), plus Playwright specs that back up and restore `backend/data/store.json`. Writing tests was a separate, parallelisable step in both modules, and the review showed the first test pass missed the HTTP layer. A dedicated agent with that checklist would close the gap.
3. **`plan-splitter`:** reads an implementation plan, finds which files each step touches and what it imports, and outputs a dependency graph with parallel groups. Steps that write the same file go into one group. This is exactly the judgement call that went better than my own labels in this exercise.
4. **`verifier`:** a read-and-run agent that runs `tsc --noEmit` in both packages, `npm test` and `npm run test:e2e` (with the store backed up), then reports pass or fail. Every phase ends with the same checklist, so it should be one reusable agent.

## 5. How long would this feature have taken without parallel subagents?

The actual run, measured from the session timestamps:
- **Implementation (plan pasted → Phase 3 verified):** about 10 minutes, including installing Node and Playwright in the sandbox.
- **Review (three parallel reviewers):** about 1.5 minutes.
- **Fixing the review findings (backend by the main session, frontend by an agent in parallel):** about 3 minutes.
- **Total:** about 18 minutes of wall-clock time.

Estimates without parallel subagents:
- **One Claude session doing every step in order:** about 30–45 minutes. Steps 3–6 and the three reviews would each run one after another instead of side by side.
- **By hand, without AI:** about 4–6 hours for the same result. That covers the types, helper, two endpoints with validation and CSV escaping, the React view with loading, error and refresh handling, 35 new backend tests, 2 E2E specs, and the review fixes. Realistically, the formula-injection and rounding fixes, the "At limit" state and the HTTP tests might not have happened at all in a first pass.

Parallelism saved real time in Phase 2 and in the review. Most of the remaining time went to sequential work that can't be parallelised: Phase 1, verification, and environment setup.
