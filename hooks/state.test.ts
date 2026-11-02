import { expect, test } from 'claude-code/testing'
import type { Ev, ToolInput } from './ev'
import { filesOf } from './plan'
import { currentOf, derive, INIT, step, WARN } from './state'
import type { Effect, S } from './state'

const fold = (evs: Ev[], from: S = INIT) => evs.reduce((s, ev) => step(s, ev).s, from)
const call = (id: string, tool: string, input: ToolInput, end: Partial<Extract<Ev, { t: 'tool.end' }>> = {}): Ev[] => [
  { t: 'tool.start', at: 1, id, tool, input },
  { t: 'tool.end', at: 2, id, tool, input, ok: true, edited: [], ...end },
]

test('turns toggle running; main steps set model and effort; mode, usage, compact set their fields', () => {
  let s = fold([{ t: 'turn.start', at: 1 }])
  expect(s.main.isRunning).toBe(true)
  s = fold(
    [
      { t: 'step', at: 2, model: 'opus', effort: 'high' },
      { t: 'step', at: 3, model: 'opus' },
      { t: 'step', at: 3, agentId: 'A', model: 'haiku' },
      { t: 'mode', at: 4, mode: 'plan' },
      { t: 'usage', at: 5, pct: 40, tokens: 80000, window: 200000, costUsd: 1.5, limits: [{ kind: 'five_hour', pct: 20 }] },
      { t: 'compact', at: 6 },
      { t: 'turn.end', at: 7, answer: '', failed: false, waiting: false },
    ],
    s,
  )
  expect(s.main).toMatchObject({ isRunning: false, steps: 2, model: 'opus', effort: 'high', mode: 'plan', pct: 40, tokens: 80000, window: 200000, costUsd: 1.5, compactions: 1 })
  expect(s.main.limits).toEqual([{ kind: 'five_hour', pct: 20 }])
})

test('TodoWrite replaces todos; TaskCreate adds; TaskUpdate changes and deletes', () => {
  let s = fold(call('1', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending', activeForm: 'Bing' }] }))
  expect(s.todos).toEqual({ 'todo:0': { status: 'completed', label: 'a' }, 'todo:1': { status: 'pending', label: 'Bing' } })
  s = fold(call('2', 'TodoWrite', { todos: [{ content: 'c', status: 'pending' }] }), s)
  expect(Object.values(s.todos).map(t => t.label)).toEqual(['c'])

  s = fold([...call('3', 'TaskCreate', { subject: 'Build', activeForm: 'Building' }, { createdTaskId: '7' })])
  expect(s.todos['7']).toEqual({ status: 'pending', label: 'Building', n: '7' })
  s = fold(call('4', 'TaskUpdate', { taskId: '7', status: 'in_progress', subject: 'Build it' }), s)
  expect(s.todos['7']).toEqual({ status: 'in_progress', label: 'Build it', n: '7' })
  // a failed call changes nothing
  expect(fold(call('5', 'TaskUpdate', { taskId: '7', status: 'deleted' }, { ok: false }), s).todos['7']).toBeDefined()
  s = fold(call('6', 'TaskUpdate', { taskId: '7', status: 'deleted' }), s)
  expect(s.todos['7']).toBeUndefined()
})

test('agents number after the highest kept; end sets done/failed/waiting; a later step resumes', () => {
  const spawn = (agentId: string, at: number): Ev => ({ t: 'agent.spawn', at, agentId, description: `do ${agentId}`, subagentType: 'general', model: 'sonnet' })
  let s = fold([spawn('A', 1), spawn('B', 2), spawn('C', 3)])
  expect(Object.values(s.agents).map(r => [r.n, r.label, r.status])).toEqual([
    [1, 'do A', 'running'],
    [2, 'do B', 'running'],
    [3, 'do C', 'running'],
  ])
  s = fold(
    [
      { t: 'turn.end', at: 5, agentId: 'A', answer: '', failed: false, waiting: false },
      { t: 'turn.end', at: 6, agentId: 'B', answer: '', failed: true, waiting: false },
      { t: 'turn.end', at: 7, agentId: 'C', answer: '', failed: false, waiting: true },
    ],
    s,
  )
  expect([s.agents.A, s.agents.B, s.agents.C].map(r => [r?.status, r?.endedAt])).toEqual([
    ['done', 5],
    ['failed', 6],
    ['waiting', undefined],
  ])
  s = fold([{ t: 'step', at: 8, agentId: 'A', model: 'opus' }], s)
  expect(s.agents.A).toMatchObject({ status: 'running', model: 'opus' })
  expect(s.agents.A?.endedAt).toBeUndefined()

  // 50 kept; the running one is never dropped
  let many = fold([spawn('keep', 0)])
  for (let i = 0; i < 60; i++) many = fold([spawn(`x${i}`, i + 1), { t: 'turn.end', at: i + 1, agentId: `x${i}`, answer: '', failed: false, waiting: false }], many)
  expect(Object.keys(many.agents).length).toBe(50)
  expect(many.agents.keep?.status).toBe('running')
  expect(many.agents.x0).toBeUndefined()
  expect(many.agents.x59?.n).toBe(61)
})

test('skills append; the same name twice in a row is one entry; 30 kept', () => {
  let s = fold([
    { t: 'skill', at: 1, name: 'brainstorming', fromSubagent: false },
    { t: 'skill', at: 2, name: 'brainstorming', fromSubagent: false },
    { t: 'skill', at: 3, name: 'writing-plans', fromSubagent: true },
  ])
  expect(s.skills.map(k => k.name)).toEqual(['brainstorming', 'writing-plans'])
  for (let i = 0; i < 40; i++) s = fold([{ t: 'skill', at: i, name: `s${i}`, fromSubagent: false }], s)
  expect(s.skills.length).toBe(30)
  expect(s.skills.at(-1)?.name).toBe('s39')
})

test('main-loop tools show as activity rows that settle ok or error; 10 kept, ids continue', () => {
  let s = fold([{ t: 'tool.start', at: 1, id: 't1', tool: 'Bash', input: { command: 'bun test', description: 'Run tests' } }])
  expect(s.activity).toEqual([{ id: 1, at: 1, label: 'Bash · Run tests', status: 'running' }])
  s = fold([{ t: 'tool.end', at: 2, id: 't1', tool: 'Bash', input: { command: 'bun test', description: 'Run tests' }, ok: false, edited: [] }], s)
  expect(s.activity[0]?.status).toBe('error')
  s = fold(call('t2', 'Read', { file_path: '/a/plan.ts' }), s)
  expect(s.activity[1]).toMatchObject({ id: 2, label: 'Read · plan.ts', status: 'ok' })
  // a subagent's tool is not main-loop activity
  expect(fold([{ t: 'tool.start', at: 3, agentId: 'A', id: 't3', tool: 'Bash', input: {} }], s).activity.length).toBe(2)
  for (let i = 0; i < 12; i++) s = fold(call(`m${i}`, 'Grep', { pattern: 'x' }), s)
  expect(s.activity.map(a => a.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  expect(s.activity.every(a => a.status === 'ok')).toBe(true)
})

test('derive: todos win unless all done while a plan-mode plan has open work', () => {
  const plan = { path: '/r/.claude/plans/p.md', text: '', tasks: [{ status: 'pending' as const, label: 'plan step' }], warned: false }
  const doneTodos = fold(call('1', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }] }))
  expect(derive({ ...doneTodos, plan }, 0).shown.map(t => t.label)).toEqual(['plan step'])
  expect(derive(doneTodos, 0).shown.map(t => t.label)).toEqual(['a'])
  const openTodos = fold(call('2', 'TodoWrite', { todos: [{ content: 'b', status: 'pending' }] }))
  expect(derive({ ...openTodos, plan }, 0).shown.map(t => t.label)).toEqual(['b'])
})

test('derive: busy while main runs or any agent is running or waiting', () => {
  expect(derive(INIT, 0).busy).toBe(false)
  expect(derive(fold([{ t: 'turn.start', at: 1 }]), 0).busy).toBe(true)
  const waiting = fold([
    { t: 'agent.spawn', at: 1, agentId: 'A', description: '', subagentType: 'explore', model: '' },
    { t: 'turn.end', at: 2, agentId: 'A', answer: '', failed: false, waiting: true },
  ])
  expect(derive(waiting, 0).busy).toBe(true)
  expect(derive(waiting, 0).runs[0]?.label).toBe('explore')
})

const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const LEDGER = '/r/.superpowers/sdd/2026-01-01-x/progress.md'
const HEAD = '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n'
const PLAN = [
  '### Task 1: One',
  '**Files:**',
  '- Create: `hooks/one.ts`',
  '- [ ] a',
  '### Task 2: Two',
  '**Files:**',
  '- Modify: `hooks/a.ts:10-20`, `README.md` (the `View` type)',
  '- Test: `hooks/a.test.ts`',
  '- [ ] b',
  '### Task 3: Three',
  '**Files:**',
  '- Modify: `hooks/a.ts`',
  '- [ ] c',
  '',
].join('\n')
const run = (evs: Ev[], from: S = INIT) =>
  evs.reduce<{ s: S; effects: Effect[] }>(({ s, effects }, ev) => {
    const r = step(s, ev)
    return { s: r.s, effects: [...effects, ...r.effects] }
  }, { s: from, effects: [] })
const skill = (name: string, fromSubagent = false): Ev => ({ t: 'skill', at: 10, name, fromSubagent })
const ledger = (text: string): Ev => ({ t: 'file', at: 4, path: LEDGER, text: HEAD + text })
const planned = (text = PLAN, path = SP): Ev[] => [...call(`w${path}`, 'Write', { file_path: path }), { t: 'file', at: 3, path, text }]
const edit = (path: string): Ev[] => call(`e:${path}`, 'Edit', { file_path: path }, { edited: [path] })
const bash = (command: string, edited: string[] = []): Ev[] => call(`b:${command}`, 'Bash', { command }, { edited })
const spawn = (agentId: string, description: string): Ev => ({ t: 'agent.spawn', at: 20, agentId, description, subagentType: 'general', model: 'haiku' })

test('filesOf reads Create/Modify/Test backticks, drops line ranges, ignores fenced code', () => {
  expect(filesOf(PLAN)).toEqual({ '1': ['hooks/one.ts'], '2': ['hooks/a.ts', 'README.md', 'hooks/a.test.ts'], '3': ['hooks/a.ts'] })
  expect(filesOf('### Task 1: A\n```\n- Modify: `x.ts`\n```\n- Modify: `y.ts:5`\n')).toEqual({ '1': ['y.ts'] })
})

test('an edit of a task file makes it current: lowest open task wins, then the next once done; sticky across unlisted files', () => {
  let s = fold(edit('/r/hooks/a.ts'), fold(planned()))
  expect(currentOf(s.plan)).toEqual(['2'])
  // only Tasks 2 and 3 open from here
  s = fold([...planned(PLAN.replace('- [ ] a', '- [x] a')), ...edit('/r/hooks/a.ts')])
  expect(currentOf(s.plan)).toEqual(['2'])
  s = fold([...edit('/r/README.notes'), ...edit('/r/package.json')], s)
  expect(currentOf(s.plan)).toEqual(['2'])
  s = fold([ledger('Task 2: complete (x)\n')], s)
  expect(currentOf(s.plan)).toEqual(['3'])
  s = fold(edit('/r/hooks/a.ts'), s)
  expect(s.plan.edited).toBe('3')
})

test('current task precedence: dispatched > task-start > edited', () => {
  let s = fold([...planned(), ...edit('/r/hooks/one.ts')])
  expect(currentOf(s.plan)).toEqual(['1'])
  s = fold(bash('scripts/task-start docs/superpowers/plans/2026-01-01-x.md 2'), s)
  expect(currentOf(s.plan)).toEqual(['2'])
  s = fold([ledger('Task 3: dispatched\n')], s)
  expect(currentOf(s.plan)).toEqual(['3'])
})

test('another plan clears what the last one knew', () => {
  const B = '/r/docs/superpowers/plans/2026-02-01-b.md'
  const s = fold([...planned(), ...edit('/r/hooks/one.ts'), ...call('r', 'Read', { file_path: B })])
  expect(s.plan).toMatchObject({ path: B, text: '', tasks: [], warned: false })
  expect(s.plan.edited).toBeUndefined()
})

test('an untied edit in execute warns once per gap', () => {
  const exec = run([...planned(), skill('executing-plans')]).s
  let r = run([...edit('/r/notes.md'), ...edit('/r/notes.md')], exec)
  expect(r.effects).toEqual([{ kind: 'warn', toolId: 'e:/r/notes.md', text: WARN }])
  r = run([...bash('task-start docs/superpowers/plans/2026-01-01-x.md 1'), ledger('Task 1: complete\n'), ...edit('/r/notes.md')], r.s)
  expect(r.effects.length).toBe(1)
  // outside execute: none
  expect(run(edit('/r/notes.md'), run(planned()).s).effects).toEqual([])
  // the plan, the ledger or a spec itself: none
  expect(run([...edit(SP), ...edit(LEDGER), ...edit('/r/docs/superpowers/specs/x-design.md')], exec).effects).toEqual([])
})

test('the vee-app shape: a Bash edit of a listed file is current, no warning', () => {
  const plan = '### Task 1: Seed\n**Files:**\n- Modify: `src/seed.ts`\n- [ ] a\n### Task 2: Docs\n**Files:**\n- Modify: `AGENTS.md`\n- [ ] b\n'
  const r = run([...planned(plan), skill('executing-plans'), ledger('Task 1: Ruling: skip seeding\n'), ...bash("sed -i '' 's/x/y/' AGENTS.md", ['/r/AGENTS.md'])])
  expect(currentOf(r.s.plan)).toEqual(['2'])
  expect(r.effects).toEqual([])
})

test('stages: skills move, a reply sizes brainstorming, extras add, a spec reaches spec', () => {
  let s = fold([skill('superpowers:brainstorming'), { t: 'turn.end', at: 11, answer: 'A quick spike would show it', failed: false, waiting: false }, skill('test-driven-development')])
  expect(s.sp).toMatchObject({ current: 'brainstorm', path: 'spike', extras: ['tdd'], at: { brainstorm: 10 } })
  s = fold([skill('executing-plans'), { t: 'turn.end', at: 12, answer: 'bounded after all', failed: false, waiting: false }], s)
  expect(s.sp).toMatchObject({ current: 'execute', path: 'spike' })
  const spec = fold([skill('brainstorming'), ...call('s', 'Write', { file_path: '/r/docs/superpowers/specs/x-design.md' })])
  expect(spec.sp.current).toBe('spec')
  expect(spec.sp.at.spec).toBe(2)
})

test('review waits for the plan to be done; a subagent skill never moves the stage', () => {
  let s = fold([...planned('### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n'), skill('subagent-driven-development'), spawn('R1', 'Review the change')])
  expect(s.sp.current).toBe('execute')
  s = fold([skill('receiving-code-review')], s)
  expect(s.sp.current).toBe('execute')
  s = fold([{ t: 'file', at: 30, path: SP, text: '### Task 1: A\n- [x] a\n### Task 2: B\n- [x] b\n' }, spawn('R2', 'Final whole-branch review')], s)
  expect(s.sp.current).toBe('review')
  expect(s.sp.at.review).toBe(20)

  let sub = fold([skill('subagent-driven-development'), skill('requesting-code-review', true), skill('test-driven-development', true)])
  expect(sub.sp).toMatchObject({ current: 'execute', extras: ['tdd'] })
  sub = fold([skill('requesting-code-review')], sub)
  expect(sub.sp.current).toBe('review')
})

test("SDD agents get a role and task; a task-less review reaches review; a reviewer's verdict sticks", () => {
  let s = fold([skill('subagent-driven-development'), spawn('I1', 'Implement Task 1: Parser'), spawn('R1', 'Review Task 1 (spec + quality)')])
  expect([s.agents.I1, s.agents.R1].map(r => [r?.role, r?.taskN, r?.startedAt])).toEqual([
    ['impl', '1', 20],
    ['review', '1', 20],
  ])
  expect(s.sp.current).toBe('execute')
  s = fold([{ t: 'turn.end', at: 25, agentId: 'R1', answer: '**Task quality:** Needs fixes', failed: false, waiting: false }, spawn('R2', 'Review code changes')], s)
  expect(s.agents.R1?.verdict).toBe('issues')
  expect(s.sp.current).toBe('review')
  // outside superpowers, or after finish, an agent gets no role
  expect(fold([spawn('X', 'Review diff')]).agents.X?.role).toBeUndefined()
  expect(fold([skill('finishing-a-development-branch'), spawn('X', 'Review diff')]).agents.X?.role).toBeUndefined()
})

test('finish stays until another plan starts a new cycle', () => {
  const B = '/r/docs/superpowers/plans/2026-02-01-next.md'
  let s = fold([...planned('### Task 1: A\n- [x] a\n'), skill('finishing-a-development-branch'), ...call('r', 'Read', { file_path: SP })])
  expect(s.sp.current).toBe('finish')
  s = fold(planned('### Task 1: A\n- [ ] a\n', B), s)
  expect(s.sp).toMatchObject({ current: 'plan', stages: ['plan'] })
})

test('done stamps take ev.at when a list becomes all done and clear when it opens again', () => {
  let s = fold([...planned('### Task 1: A\n- [ ] a\n'), { t: 'file', at: 40, path: SP, text: '### Task 1: A\n- [x] a\n' }])
  expect(s.sp.doneAt).toBe(40)
  s = fold([{ t: 'file', at: 41, path: SP, text: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n' }], s)
  expect(s.sp.doneAt).toBeNull()
  s = fold(call('t', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }] }, { at: 50 }), s)
  expect(s.main.doneAt).toBe(50)
})
