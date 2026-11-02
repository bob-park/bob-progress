import { expect, test } from 'claude-code/testing'
import type { Ev, ToolInput } from './ev'
import { derive, INIT, step } from './state'
import type { S } from './state'

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
