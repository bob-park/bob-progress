# task-progress 1.0 Event-Sourced Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the pane as events → pure reducer → state → render, so real transcripts replay through the same reducer. Add trace-based current task, a once-per-gap warning, local replay checks and a version label.

**Architecture:** `hooks/ev.ts` defines the normalized event `Ev`. `hooks/state.ts` holds the pure `step(s, ev)` and `derive(s, now)`: no clock, no fs, no `claude-code` runtime imports. `hooks/register.tsx` turns hook calls into `Ev`, keeps one atom, runs effects and renders through `view.tsx`. `replay/` (local only, run with bun) turns transcripts into `Ev[]` and checks invariants.

**Tech Stack:** TypeScript Claude Code mod (`claude-code` module API), `claude plugin test .` for `hooks/*.test.ts(x)`, `bun test replay` for `replay/*.spec.ts`.

**Spec:** `docs/superpowers/specs/2026-11-02-event-sourced-monitor-design.md`

## Global Constraints

- `hooks/ev.ts` and `hooks/state.ts` (and any module they import) import only relative files and `import type`. No `claude-code` values, no `node:*`. bun must be able to import them.
- The pane looks and behaves as README describes today. The one addition is a dim `v1.0.0` at the right of the main panel's first line.
- The warning never blocks a call (no `deny`). It is attached at most once per gap, with this exact text: `task-progress: this edit isn't tied to a plan task. Before working on a task, run \`task-start <plan> <N>\` (executing-plans) or ledger \`Task <N>: dispatched\` (subagent-driven-development).`
- Replay output names only the session file, the violation kind and the event index, plus the link-rate number. It never prints or writes transcript content (commands, paths, text). Nothing under `replay/` reads or writes inside the repo except its own code.
- Version `1.0.0` in `.claude-plugin/plugin.json` and `VERSION`.
- superpowers 7.0.1 ledger format unchanged. 6.4.1 stage and path words still read.

**Ruling (plan):** the spec puts the replay test under `claude plugin test`. A spike showed that sandbox has no `node:fs`, no `process` and no JSON imports. Replay and the version check therefore run as `bun test replay` (`*.spec.ts`, which `claude plugin test` ignores). Cost if wrong: none for users; the local check is one more command.

**Ruling (plan):** the spec says the old `fs.read`-mocking scenario tests become `Ev[]` folds. This plan does both: the reducer gets `Ev[]` tests (Tasks 1–2), and the old scenario tests in `register.test.ts` stay unchanged as an end-to-end regression net. The live hook still reads plan and ledger with `$.fs.read`, so those mocks are still real wiring. Cost if wrong: some duplicate coverage.

**Ruling (plan):** the spec lists `animate` as an effect. Here the hook derives it from `derive(...).busy` instead, because it is a pure function of state. Cost if wrong: none.

## Review Focus

- A Bash `sed -i`/`>`/`tee` edit of a plan-listed file when the live result has no `bashEditDiff` → still attributed to its task (command parse). Test in Task 3.
- The same file listed under two open tasks → the lowest-numbered open task is current. Test in Task 2.
- A file listed as an absolute path in the edit but relative (with `:12-30`) in `**Files:**` → matches. Test in Task 2.
- A hot reload with 0.9.x atoms present (`plan`, `sp`, `agents` …) → starts from `INIT`, no crash. Test in Task 3.
- A transcript line that is not JSON, or a record type the converter doesn't know → skipped; I4 holds. Test in Task 4.

---

### Task 1: Events and the reducer for main, todos, agents, skills, activity

**Files:**
- Create: `hooks/ev.ts`, `hooks/state.ts`, `hooks/state.test.ts`
- Modify: `types/index.d.ts` (`PluginState['task-progress']` becomes `{ state: S }`; keep `Task`, `AgentRun`, `Main`, `Sp`, … as they are)

**Interfaces:**
- Produces, in `hooks/ev.ts`:
  ```ts
  export type ToolInput = { file_path?: string; command?: string; description?: string; pattern?: string; subject?: string; activeForm?: string; taskId?: string; status?: string; todos?: Array<{ content: string; status: TaskStatus; activeForm?: string }> }
  export type Ev =
    | { t: 'turn.start'; at: number; agentId?: string }
    | { t: 'turn.end'; at: number; agentId?: string; answer: string; failed: boolean; waiting: boolean }
    | { t: 'step'; at: number; agentId?: string; model: string; effort?: string }
    | { t: 'tool.start'; at: number; agentId?: string; id: string; tool: string; input: ToolInput }
    | { t: 'tool.end'; at: number; agentId?: string; id: string; tool: string; input: ToolInput; ok: boolean; edited: string[]; output?: string; createdTaskId?: string; planFile?: string }
    | { t: 'file'; at: number; path: string; text: string }
    | { t: 'skill'; at: number; name: string; fromSubagent: boolean }
    | { t: 'agent.spawn'; at: number; agentId: string; description: string; subagentType: string; model: string }
    | { t: 'usage'; at: number; pct: number | null; tokens: number | null; window: number; costUsd: number | null; limits: Array<{ kind: string; pct: number }> }
    | { t: 'compact'; at: number }
    | { t: 'mode'; at: number; mode: string }
  ```
- Produces, in `hooks/state.ts`:
  - `type S = { main: Main; todos: Record<string, Task>; agents: Record<string, AgentRun>; skills: SkillUse[]; activity: Activity[]; sp: Sp; plan: PlanState }`
  - `type PlanState = { path: string; text: string; ledger?: string; tasks: Task[]; started?: string; edited?: string; warned: boolean }`
  - `type Effect = { kind: 'warn'; toolId: string; text: string }`
  - `const INIT: S`
  - `step(s: S, ev: Ev): { s: S; effects: Effect[] }`
  - `type View = { main: Main; sp: Sp; spTasks: Task[]; shown: Task[]; runs: AgentRun[]; skills: string[]; activity: Activity[]; busy: boolean }`
  - `derive(s: S, now: number): View`. `busy` = main running or any agent running/waiting.
- In this task, `plan` and `sp` pass through unchanged. Task 2 fills them in.

- [ ] **Step 1: Write the failing tests** in `hooks/state.test.ts`. They port today's behaviour, now driven by `Ev[]` folded with `step` (a local helper `fold(evs) => S`):
  - `turn.start`/`turn.end` toggle `main.isRunning`. `step` without `agentId` counts `main.steps` and sets model/effort. `mode`, `usage` and `compact` (main loop only) set their fields.
  - TodoWrite replaces `todos`. TaskCreate adds `{ n: createdTaskId }`. TaskUpdate changes status/label, and `deleted` removes it.
  - `agent.spawn` adds a run numbered after the highest kept. `turn.end` with `agentId` sets `done`, `failed`, or `waiting` (no `endedAt`). A later `step` with that `agentId` sets `running` again. At most 50 runs are kept, and running ones are never dropped.
  - `skill` appends a name, and the same name twice in a row stays one entry (30 kept).
  - Main-loop `tool.start` pushes a running activity row labelled like `Bash · Run tests`. Its `tool.end` settles it `ok`/`error`. 10 rows are kept, and ids continue after kept rows.
  - `derive(s, now).shown` follows today's rule: todos win unless all are done while a plan-mode plan still has open work.

- [ ] **Step 2: Run to verify they fail**
  Run: `claude plugin test .`
  Expected: `hooks/state.test.ts` fails to load (`./state` missing). Other files pass.

- [ ] **Step 3: Implement `hooks/ev.ts` and `hooks/state.ts`.** Move the pure helpers `trimAgents`, `pushActivity`, `activityOf` and `shownTasks` out of `register.tsx` into `state.ts`. Don't wire `register.tsx` yet.

- [ ] **Step 4: Run to verify they pass**
  Run: `claude plugin test .`
  Expected: all pass. Also `bun -e "import('./hooks/state.ts').then(m => console.log(typeof m.step))"` prints `function`.

- [ ] **Step 5: Commit**
  ```bash
  git add hooks/ev.ts hooks/state.ts hooks/state.test.ts types/index.d.ts
  git commit -m "feat: 이벤트 타입과 main/todo/agent/skill/activity reducer"
  ```

### Task 2: Superpowers, plan and the current task in the reducer

**Files:**
- Modify: `hooks/state.ts`, `hooks/state.test.ts`
- Move into `hooks/state.ts` (or `hooks/sp.ts` imported by it), then delete: `hooks/plan.ts`, `hooks/superpowers.ts`. Their tests `hooks/plan.test.ts` and `hooks/superpowers.test.ts` keep their assertions and switch imports.

**Interfaces:**
- Consumes: Task 1's `Ev`, `S`, `PlanState`, `Effect`, `step`, `derive`.
- Produces: `filesOf(planText: string): Record<string, string[]>`, mapping task n → paths from `**Files:**` `Create:`/`Modify:`/`Test:` backtick paths with any `:line-range` dropped. `currentOf(p: PlanState): string[]` gives the task n's that are current. `WARN: string` is the exact text from Global Constraints. `isEdit(ev: Ev): boolean`: main-loop, `ok`, `edited.length > 0`.
- These keep their current signatures and behaviour: `parsePlan`, `keepCompleted`, `ledgerPath`, `ledgerOwns`, `isPlanPath`, `isSpecPath`, `startedOf`, `reach`, `stageTimes`, `stageOfRun`, `pipeline`, `pathFrom`, `sizeUp`, `roleOf`, `taskNOf`, `verdictOf`, `fitTail`, `skillName`, `stageOf`, `extraOf`.

The reducer rules:
- **`skill`.** It moves the stage only when `!fromSubagent` (review waits for `reviewReady`). Otherwise it adds an extra.
- **`turn.end` (main loop).** `pathFrom(answer)` sizes the work while the stage is brainstorm.
- **`agent.spawn`.** It sets role/taskN, and a task-less review in execute with every task done reaches review.
- **`tool.end` (main loop, `ok`):**
  - `planFile`, or an Edit/Write/Read whose path `isPlanPath`, sets `plan.path`. A different file name clears `text`, `ledger`, `started`, `edited` and `warned`. A superpowers plan reaches `plan` as today.
  - An Edit/Write of a spec reaches `spec`.
  - `startedOf(command, plan.path)` sets `started`.
- **`file`.**
  - An `isPlanPath` path is the plan text. It adopts the path when none is set or the file names match.
  - A path equal to `ledgerPath(plan.path)` is the ledger, used when `ledgerOwns`.
  - Either one re-runs `parsePlan(text, ledger, started)` + `keepCompleted`.
- **Rule 3.** A main-loop `isEdit` whose any `edited` path suffix-matches a path in `filesOf(text)[n]` for an open task n sets `edited = n`. On ties, the lowest open n wins. Paths compare by trailing segments, so `/abs/repo/hooks/a.ts` matches `hooks/a.ts`. An edit to an unlisted file leaves `edited` alone (sticky).
- **Current task precedence.** dispatched > `started` if open > `edited` if open > the existing rule 4. Feed it to `parsePlan` the same way `started` is today: one `in_progress`, or several for dispatched.
- **Warning.** On a main-loop `isEdit` with `sp.current === 'execute'` and a superpowers plan, where the edited paths are not the plan/spec/ledger and rules 1–3 give nothing open, `step` returns `{ kind: 'warn', toolId: ev.id, text: WARN }` if `!warned`, and sets `warned = true`. When rules 1–3 give a task again, `warned` resets to `false`.
- **`done` stamps.** `main.doneAt` and `sp.doneAt` are stamped with `ev.at` when their list becomes all done and cleared when it opens again (today's `stampDone`, now using `ev.at` instead of the clock).

- [ ] **Step 1: Write the failing tests** in `hooks/state.test.ts`:
  - `filesOf` reads `Create`/`Modify`/`Test` backticks, drops `:123-145`, and ignores fenced code.
  - An edit of `/r/hooks/a.ts` with Task 2 listing `hooks/a.ts:10-20` → `currentOf` gives `['2']`.
  - The same file under open Tasks 2 and 3 → `['2']`. After `Task 2: complete` in a `file` ledger event → `['3']`.
  - Sticky: edit Task 2's file, then `README.md` → still `['2']`.
  - Precedence: ledger `Task 3: dispatched` beats `started` `2` beats `edited` `1`.
  - Warning: in execute, plan known, no signals, two edits of an unlisted file → one effect total. Then `task-start … 1`, its completion, and an unlisted edit → a second effect. An edit outside execute → none. An edit of the plan or ledger itself → none.
  - The vee-app shape: plan with 2 tasks, the `executing-plans` skill, a ledger with only `Task 1: Ruling: …`, then a Bash `tool.end` with `edited: ['/r/AGENTS.md']` where Task 2 lists `AGENTS.md` → current `['2']`, no warning.
  - Stage moves (port today's register tests for `skill`/`agent.spawn`/review waits/whole-branch review/subagent skill/finish then new cycle) as `Ev[]` folds.

- [ ] **Step 2: Run to verify they fail**
  Run: `claude plugin test .`
  Expected: the new tests fail (`filesOf`/`currentOf` missing, no effects). The moved plan/superpowers tests pass from their new imports once the files are moved.

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run to verify they pass**
  Run: `claude plugin test .`
  Expected: all pass.

- [ ] **Step 5: Commit**
  ```bash
  git add -A hooks
  git commit -m "feat: superpowers 단계, plan, 흔적 기반 현재 task와 경고를 reducer로"
  ```

### Task 3: Hooks emit events; one atom; version label

**Files:**
- Modify: `hooks/register.tsx` (rewrite), `hooks/view.tsx` (inputs from `View`; `mainPanel` gets `version`), `hooks/register.test.ts`
- Create: `hooks/version.ts`

**Interfaces:**
- Consumes: `Ev`, `INIT`, `step`, `derive`, `View`, `Effect`, `ledgerPath`, `isPlanPath`.
- Produces: `export const VERSION = '1.0.0'` in `hooks/version.ts`. `editedOf(command: string, result: unknown): string[]`, exported from `state.ts` so replay can share it. It returns `result.bashEditDiff.changedFiles` when that is a string array, else targets parsed from `sed -i[suffix] … FILE`, `> FILE`, `>> FILE` and `tee [-a] FILE` (`2>`/`&>` and `/dev/null` excluded).

Wiring:
- One atom: `atom({ plugin: 'task-progress', key: 'state' }, INIT)`. Old keys are never read. Every hook builds an `Ev` with `at = await $.clock.now()` and runs `update($, state, s => step({ ...INIT, ...s }, ev).s)`. Effects come from the same `step` call.
- `tool.call`:
  - Emits `tool.start` before `next` and `tool.end` after it.
  - `edited` is `[file_path]` for Edit/Write/NotebookEdit and `editedOf(command, ran.result)` for Bash. `createdTaskId` comes from TaskCreate; `planFile` comes from ExitPlanMode.
  - A thrown `next` emits `tool.end` with `ok: false` and rethrows.
  - After a main-loop `tool.end`, when `s.plan.path` is set, it reads the plan and `ledgerPath` with `$.fs.read`. Each successful read is emitted as a `file` event; a failed read emits nothing.
  - A `warn` effect for this call's id appends its text to `ran.context`. The ExitPlanMode tick hint stays as today.
- Subagent skill detection keeps today's counter around Skill `tool.call`s with `agentId` and sets `fromSubagent`.
- The animation clock runs while `derive(...).busy`.
- `ui.render` draws from `derive(s, now)`. `mainPanel` puts `v${VERSION}` dim at the right of its first line.

- [ ] **Step 1: Write the failing tests** in `hooks/register.test.ts`. All existing scenario tests stay and must keep passing unchanged, except two:
  - `an agent saved without a status (0.6)` → delete it; old atoms are no longer read.
  - `a new activity row takes the next id` → move it to `state.test.ts` against `pushActivity`.

  New tests:
  - `main panel shows the version`: mount → `find({ text: /v1\.0\.0/ })` has `dimColor` true.
  - `a Bash edit of a task's file makes it current`:
    - Plan: Task 1 lists `` `src/a.ts` ``; Task 2 lists `` `AGENTS.md` ``.
    - The `executing-plans` skill runs, then a Bash `tool.call` with `command: "sed -i '' 's/x/y/' AGENTS.md"` and a mocked result without `bashEditDiff`.
    - Expected: `▸ #2` shows.
  - `bashEditDiff wins over the command parse`: the mocked result is `{ bashEditDiff: { changedFiles: ['/r/src/a.ts'] } }` with `command: 'python3 fix.py'` → `▸ #1`.
  - `an untied edit in execute gets the warning once`:
    - Two Edit calls on `/r/notes.md` in execute with no signal.
    - Expected: only the first returned `context` contains the WARN text, and neither call has `deny`.
  - `0.9.x atoms left from a hot reload are ignored`: before any event, write `plan` and `sp` atoms with junk via the kit's atom API (or `update` on those keys) → mount renders the main panel without throwing.

- [ ] **Step 2: Run to verify they fail**
  Run: `claude plugin test .`
  Expected: the new tests fail. The ported scenario tests still pass against the old `register.tsx`.

- [ ] **Step 3: Rewrite `hooks/register.tsx`** to the wiring above. Delete the code that moved into `state.ts`.

- [ ] **Step 4: Run to verify they pass**
  Run: `claude plugin test .`
  Expected: all pass, the existing scenario tests included.

- [ ] **Step 5: Commit**
  ```bash
  git add -A hooks types
  git commit -m "feat: hook을 이벤트로 바꾸고 상태 atom 하나로 렌더, 버전 표시"
  ```

### Task 4: Local replay, invariants, version check, release 1.0.0

**Files:**
- Create: `replay/fromTranscript.ts`, `replay/check.ts`, `replay/replay.spec.ts`, `replay/version.spec.ts`
- Modify: `.claude-plugin/plugin.json` (`"version": "1.0.0"`), `README.md`

**Interfaces:**
- Consumes: `Ev`, `INIT`, `step`, `currentOf`, `isEdit`, `isPlanPath`, `ledgerPath`, `editedOf`, `VERSION`.
- Produces:
  - `fromTranscript(lines: string[], readSubagent: (agentId: string) => string[] | undefined, readDisk: (absPath: string) => string | undefined): { evs: Ev[]; skipped?: string }`.
  - `check(evs: Ev[]): { violations: Array<{ kind: 'I1' | 'I2' | 'I3' | 'I4'; at: number }>; linked: number; edits: number }`. `at` is the event index.

Converter rules (read the real files to learn the exact field names; the spec's "builder" items):
- Each record's `timestamp` becomes `at`. `isSidechain` records and `subagents/` files carry `agentId`. Lines that fail to parse are skipped.
- Assistant `tool_use` → `tool.start`. The matching `tool_result` + `toolUseResult` → `tool.end`. `edited` comes from Edit/Write paths or `editedOf(command, toolUseResult)`.
- A `Skill` tool_use → `skill`, with `fromSubagent` set when it carries an `agentId`. An `Agent` tool_use → `agent.spawn`, and its result → `turn.end` for that agent.
- `file` events:
  - Write content, Read output and Edit applied to the last known text.
  - The ledger, accumulated from `ledger: …` lines in `task-done` output, the bodies of `echo`/`printf` redirected into `…/progress.md`, and Write/Edit of `progress.md`. A full `file` event is emitted after each change.
  - When a plan path first appears in any Bash command and the transcript has no plan text yet, `readDisk(abs)` is emitted as `file`. Paths resolve against the record's `cwd`.
  - If there is no plan text at all, the session returns `skipped: 'no plan'`.

Invariants, as in the spec:
- **I1.** For each main-loop `isEdit` in execute with a superpowers plan and open tasks: either `currentOf` was non-empty after the event (rules 1–3 only, not rule 4), or a warn effect came in the same gap.
- **I2.** The completed count per plan never drops, and the stage never moves back within a cycle.
- **I3.** The final completed count per plan equals the number of tasks with ledger-write evidence or all steps ticked in the final plan text.
- **I4.** No throw in `fromTranscript` or the fold.
- `linked / edits` counts the execute-stage main-loop edits tied by rules 1–3.

`replay.spec.ts`:
- It scans `process.env.REPLAY_DIR ?? ~/.claude/projects` for `*.jsonl` that contain `superpowers:executing-plans` or `superpowers:subagent-driven-development`. If there are none, it is `test.skip`.
- It runs one `test` per session, named by the file's basename only. The test fails on any violation and its message lists `kind@index` only.
- It prints `basename linked/edits (pct)` per session and `skipped: <reason>` for skipped sessions.

- [ ] **Step 1: Write the failing tests**:
  - `replay/version.spec.ts`: `VERSION` equals `plugin.json`'s `version`.
  - In `replay/replay.spec.ts`, a `describe('converter')` block with tiny inline synthetic lines (no real data):
    - A Write of a plan, a Skill `executing-plans` and a Bash `task-done` output `ledger: Task 1: complete (…)` → final plan has Task 1 completed.
    - A non-JSON line and an unknown `type` → skipped, no throw.
    - A Bash command `cat docs/superpowers/plans/x.md` with no plan text and `readDisk` returning text → a `file` event.
    - `check` reports `I2` for a synthetic fold where a later ledger drops a completion, and reports nothing for the vee-app shape from Task 2.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test replay`
  Expected: the version spec fails (0.9.2 ≠ 1.0.0); the converter specs fail (`./fromTranscript` missing).

- [ ] **Step 3: Implement** the converter, `check`, and the corpus loop. Bump `plugin.json` to `1.0.0`. In README:
  - describe the 1.0 structure in two lines;
  - add the version label to the main bullet;
  - add the warning to the execute bullet;
  - add a "Local replay" section: `bun test replay`, `REPLAY_DIR`, and that nothing from transcripts is printed or stored.

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test replay` and `claude plugin test .`
  Expected:
  - Both green. The spec suite shows one test per local session and passes, with skipped sessions listed.
  - The link-rate lines are printed.
  - A real I2/I3/I4 violation is a reducer or converter bug: debug it (superpowers:systematic-debugging), fix with a failing synthetic test first, and never special-case a session.

- [ ] **Step 5: Commit**
  ```bash
  git add replay .claude-plugin/plugin.json README.md
  git commit -m "feat: 로컬 transcript 재생 불변식 검사와 버전 확인, 버전 1.0.0"
  ```
