# Inline Execute Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While `executing-plans` runs a plan inline, the execute row shows the task the main loop started with `task-start PLAN N` as current.

**Architecture:** `plan.ts` gets a pure parser for the `task-start` command and a third input to `parsePlan` (the started task). `register.tsx` records the started task on the `plan` atom from main-loop Bash calls and passes it into `parsePlan` on every re-read.

**Tech Stack:** TypeScript Claude Code mod (`claude-code` module API), tests via `claude plugin test .`

**Spec:** `docs/superpowers/specs/2026-11-02-inline-execute-progress-design.md`

## Global Constraints

- Current-task precedence: ledger `dispatched` (SDD) > started task still open > the existing rule.
- Only a main-loop `Bash` call that succeeded counts; the plan in the command must have the same file name as the current plan.
- `task-start` alone never sets a plan the pane doesn't know yet. `task-brief` is not watched.
- The started task survives plan re-reads and is dropped when the plan changes.
- Task numbers may carry a letter (`3b`, `3B` reads as `3b`).

## Review Focus

- `task-start` given an absolute path, a `./`-relative path or a quoted path to the same plan → still counts (file name compare).
- `task-start` for another plan's file → ignored.
- The started task already has `Task N: complete` → not current; the existing rule picks the first open one.
- A `task-start` call that failed (`isError`) → ignored.
- The script called by its full path (`…/executing-plans/scripts/task-start docs/…/x.md 2`) → counts.

---

### Task 1: Started task from `task-start`

**Files:**
- Modify: `types/index.d.ts` (`Plan`)
- Modify: `hooks/plan.ts` (`startedOf`, `parsePlan`)
- Modify: `hooks/register.tsx` (`refreshPlan`, `tool.call`)
- Modify: `.claude-plugin/plugin.json`, `README.md`
- Test: `hooks/plan.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Produces: `type Plan = { path: string; tasks: Task[]; started?: string }`
- Produces: `startedOf(command: string, planPath: string): string | undefined`. Returns the lower-cased task number of a `task-start <plan> <N>` in the command when `<plan>`'s file name (quotes stripped) equals `planPath`'s.
- Produces: `parsePlan(text: string, ledger?: string, started?: string): Task[]`

- [ ] **Step 1: Write the failing tests**

In `hooks/plan.test.ts`:

```ts
test('startedOf reads task-start for the same plan only', () => {
  const P = '/r/docs/superpowers/plans/2026-01-01-x.md'
  expect(startedOf('/h/skills/executing-plans/scripts/task-start docs/superpowers/plans/2026-01-01-x.md 2', P)).toBe('2')
  expect(startedOf(`scripts/task-start "${P}" 3B && cat brief`, P)).toBe('3b')
  expect(startedOf('task-start ./docs/superpowers/plans/2026-01-01-x.md 1', P)).toBe('1')
  expect(startedOf('task-start docs/superpowers/plans/other.md 2', P)).toBeUndefined()
  expect(startedOf('task-brief docs/superpowers/plans/2026-01-01-x.md 2', P)).toBeUndefined()
})

test('started task is current unless dispatched wins or it is done', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s'
  expect(parsePlan(plan, undefined, '1').map(t => t.status)).toEqual(['in_progress', 'pending', 'pending'])
  expect(parsePlan(plan, '- Task 1: complete', '2').map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(parsePlan(plan, '- Task 3: dispatched', '2').map(t => t.status)).toEqual(['pending', 'pending', 'in_progress'])
  expect(parsePlan(plan, '- Task 1: complete', '1').map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
})
```

In `hooks/register.test.ts` (uses `SP`, `LEDGER`, `pane` fixtures):

```ts
test('inline execution: task-start makes its task current; a failed call or another plan does not', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: Real run\n- [ ] a\n### Task 2: Docs\n- [ ] b\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\nTask 1: Ruling: skip seeding\n',
  }
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => ((e as { command?: string }).command?.includes('FAIL') ? { result: {}, isError: true } : { result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:executing-plans', text: '' })
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command } as never)
  const current = async () => {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    const line = (await ui.find({ text: /^▸ #/ }))?.text
    await ui.unmount()
    return line
  }

  expect(await current()).toBeUndefined()
  await bash('scripts/task-start docs/superpowers/plans/other.md 1')
  await bash('scripts/task-start docs/superpowers/plans/2026-01-01-x.md 2 FAIL')
  expect(await current()).toBeUndefined()

  await bash('scripts/task-start docs/superpowers/plans/2026-01-01-x.md 1')
  expect(await current()).toBe('▸ #1 Real run')
  await bash('ls') // a re-read keeps it
  expect(await current()).toBe('▸ #1 Real run')

  files[LEDGER] += 'Task 1: complete (commits a..b, tests: yarn test → pass)\n'
  await bash('scripts/task-start docs/superpowers/plans/2026-01-01-x.md 2')
  expect(await current()).toBe('▸ #2 Docs')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: the three new tests FAIL (`startedOf` not exported; no `▸ #1` line).

- [ ] **Step 3: Implement**

- `types/index.d.ts`: add `started?: string` to `Plan`.
- `hooks/plan.ts`: export `startedOf`. Match `\btask-start\s+(\S+)\s+(\d+[a-zA-Z]?)\b`, strip `'`/`"` from the path, compare `basename`s. In `parsePlan`, when no dispatched task is running and `started` names an open task, return the same shape as the dispatched branch with only that task `in_progress`.
- `hooks/register.tsx`:
  - `refreshPlan($, path, started?)`: same plan file name keeps `prev.started` unless a new `started` is given; a different plan drops it. Pass the kept value to `parsePlan` and store it on the atom.
  - In `tool.call`'s main-loop part, after the plan path is resolved: when `e.tool === 'Bash'` and `prev?.path`, `startedOf(e.command, prev.path)` and pass it to `refreshPlan`.
  - `keepCompleted` stays as is: it already keeps a task that `parsePlan` returned `in_progress`.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test .`
Expected: all tests PASS. Also `npx -y -p typescript@5.6.3 tsc --noEmit -p .` exits 0.

- [ ] **Step 5: Version and README, then commit**

Set `.claude-plugin/plugin.json` `"version": "0.9.2"`. In the README execute-row bullet, after "(the ledger's `Task N: dispatched` one", add ", or when executing-plans runs it inline, the one `task-start` last took".

```bash
git add types/index.d.ts hooks/plan.ts hooks/register.tsx hooks/plan.test.ts hooks/register.test.ts .claude-plugin/plugin.json README.md
git commit -m "fix: executing-plans 직접 실행에서 task-start한 task를 현재로 표시, 버전 0.9.2"
```
