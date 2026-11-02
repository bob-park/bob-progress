import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { WARN } from './state'
import { doneTime, dur, phaseOf, shimmer } from './view'

const pane = {
  plugin: 'bob-progress',
  component: 'Pane' as const,
  requestId: 'bob-progress',
  props: { title: 'Bob Progress', isFocused: false, bodyColumns: 46, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}

/** An agent row's bit and its padding, read as `▐^_^▌✓ ` */
const unbit = (t: string) => t.replace(/^(▐\S{3}▌) ?(\S) +/, '$1$2 ')

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })

test('main panel shows idle, then working once a turn starts', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /· main$/ })).toBeDefined()
  expect(await ui.find({ text: /○ idle/ })).toBeDefined()
  expect(await ui.find({ text: /TASKS/ })).toBeUndefined() // no tasks yet: no tasks panel
  await ui.unmount()

  await $.turn.start({ text: 'go', turnId: 'T1' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working$/ })).toBeDefined() // spinner while working
})

test('tasks panel shows done/total next to the bar and the current step below', async ($, on) => {
  mock.clock(on)
  // stands for the engine answering the tool
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
  const write = (todos: ReturnType<typeof todo>[]) => $.tool.call({ tool: 'TodoWrite', todos })

  await write([todo('a', 'completed'), todo('Build', 'in_progress'), todo('c', 'pending')])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface } as never)
    expect((await ui.find({ text: /^ ?1\/3$/ }))?.props.color).toBe('blue')
    expect(await ui.find({ text: /^ · 33%$/ })).toBeDefined()
    if (surface === 'terminal') expect((await ui.find({ text: /^▓+$/ }))?.props.color).toBe('yellow')
    else {
      expect((await ui.findAll({ type: 'Svg' })).filter(s => s.props.alt === '1/3')).toHaveLength(1)
      expect(await ui.find({ text: /[█▓░]/ })).toBeUndefined()
    }
    expect(await ui.find({ text: /^▸ Building$/ })).toBeDefined()
    await ui.unmount()
  }

  await write([todo('a', 'completed'), todo('Ship', 'pending')])
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^○ 다음: Shiping$/ })).toBeDefined()
  await ui.unmount()

  await write([todo('a', 'completed')])
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓ completed · \d{2}\.\d{2}\.\d{2} (AM|PM) \d{2}:\d{2}$/ })).toBeDefined()
})

test('done time reads as yy.mm.dd AM/PM hh:mm', () => {
  expect(doneTime(new Date(2026, 9, 9, 14, 5).getTime())).toBe('26.10.09 PM 02:05')
  expect(doneTime(new Date(2026, 0, 2, 0, 30).getTime())).toBe('26.01.02 AM 12:30')
  expect(doneTime(new Date(2026, 9, 9, 12, 0).getTime())).toBe('26.10.09 PM 12:00')
})

const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const LEDGER = '/r/.superpowers/sdd/2026-01-01-x/progress.md'
const PM = '/Users/a/.claude/plans/happy-cat.md'

// stands for the engine answering every tool
const answer = (e: { tool: string }) =>
  ({ result: e.tool === 'ExitPlanMode' ? { plan: null, isAgent: false, filePath: PM } : { oldTodos: [], newTodos: [] } }) as never

test('superpowers plan fills the tasks panel and follows the ledger', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: Parser\n- [ ] a\n### Task 2: Wiring\n- [ ] a\n### Task 3: Docs\n- [ ] a\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\nTask 1: complete (x)\n',
  }
  // stands for the disk
  on('fs.read', (_$, e) => {
    if (e.path in files) return { value: files[e.path]! }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Write', file_path: SP, content: files[SP]! })
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #2 Wiring$/ })).toBeDefined()
  await ui.unmount()

  // SDD's task-done script appends from Bash: any later tool call re-reads
  files[LEDGER] += 'Task 2: complete (y)\n'
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // finishing the branch drops the ledger: done tasks stay done
  delete files[LEDGER]
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #3 Docs$/ })).toBeDefined()
  await ui.unmount()

  // plan gone: keep what we had
  delete files[SP]
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // todos get their own TASKS section beside the plan
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Only', 'pending')] })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/1$/ })).toBeDefined()
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
})

test('a superpowers plan shows under SUPERPOWERS, not TASKS, with its done time', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
  expect(await ui.find({ text: /TASKS$/ })).toBeUndefined()
  expect(await ui.find({ text: /^✓ completed · \d{2}\.\d{2}\.\d{2} (AM|PM) \d{2}:\d{2}$/ })).toBeDefined()
})

test('plan mode: ExitPlanMode makes its file the active plan and asks Claude to tick steps', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => {
    if (e.path === PM) return { value: '# Plan\n- [x] Read code\n- [ ] Edit file\n' }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', (_$, e) => answer(e))

  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context).toEqual([`Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${PM} as you finish it.`])

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ Edit file$/ })).toBeDefined() // checkboxes carry no number
})

test('reading a plan written in an earlier session makes it the active plan', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
})

test('activity lists the latest main-loop tool calls, newest on top, ✗ on error', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_$, e) => (e.tool === 'Read' ? { result: {}, isError: true } : { result: {} }) as never)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/r/a/missing.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/r/a/plan.ts' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeDefined()
  const rows = await ui.findAll({ text: /^[✓✗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \w+ · / })
  expect(rows.map(r => r.text)).toEqual(['✓ Grep · TODO', '✓ Edit · plan.ts', '✗ Read · missing.ts']) // the latest 3
  expect(await ui.find({ text: /^\d\d:\d\d $/ })).toBeDefined()
})

test('a tool call shows as running until it returns', async ($, on) => {
  mock.clock(on)
  let running = false
  on('tool.call', async () => {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    running = !!(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Run tests$/ }))
    await ui.unmount()
    return { result: {} } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
  expect(running).toBe(true)
})

test('skills list every skill run in order, a repeat in a row once', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['superpowers:brainstorming', 'superpowers:brainstorming', 'commit', 'superpowers:writing-plans'])
    await $.skill.prompt({ skill, text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^SKILLS$/ })).toBeDefined()
  expect(await ui.find({ text: /^brainstorming → commit → writing-plans$/ })).toBeDefined()
})

test('agents list below the tasks: num, label, model and mm:ss', async ($, on) => {
  const clock = mock.clock(on)
  // stands for the engine starting and ending agents
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description === 'Explore auth' ? 'A1' : 'A2' }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const end = (agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId, reason: 'answer' } as never)

  await $.agent.spawn({ prompt: 'p', description: 'Explore auth' } as never)
  await clock.advance(41_000)
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  await clock.advance(42_000)

  // the latest on top
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^AGENTS$/ })).toBeDefined()
  expect(await ui.find({ text: /^  2 running · 0 done$/ })).toBeDefined()
  const rows = await ui.findAll({ text: /^▐•_•▌ ?» +\d: / })
  expect(rows.map(r => r.text)).toEqual([
    expect.stringMatching(/^▐•_•▌ ?» +2: Review diff -+ Haiku 5\.5 00:42$/),
    expect.stringMatching(/^▐•_•▌ ?» +1: Explore au… -+ Haiku 5\.5 01:23$/),
  ])
  await ui.unmount()

  // a finished one stays below the running ones with ✓ and its final time
  await end('A1')
  await clock.advance(10_000)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect((await ui.findAll({ text: /^▐\S{3}▌ ?\S +\d: / })).map(r => r.text)).toEqual([
    expect.stringMatching(/^▐•_•▌ ?» +2: Review diff -+ Haiku 5\.5 00:52$/),
    expect.stringMatching(/^▐\^_\^▌✓ +1: Explore au… -+ Haiku 5\.5 01:23$/),
  ])
  await ui.unmount()

  // a new prompt keeps them; a failed one is ✗ and counted
  await $.turn.start({ text: 'next', turnId: 'T2' })
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: 'A2', reason: 'error' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^  0 running · 1 done · 1 failed$/ })).toBeDefined()
  expect(await ui.find({ text: /^▐x_x▌✗ +2: Review diff / })).toBeDefined()
  expect(await ui.find({ text: /^▐\^_\^▌✓ +1: Explore au… / })).toBeDefined()
})

test('agents show the latest 3 ended ones, and keep at most 50', async ($, on) => {
  const clock = mock.clock(on)
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  for (let i = 1; i <= 52; i++) {
    await $.agent.spawn({ prompt: 'p', description: `Job ${i}` } as never)
    await clock.advance(1000)
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: `A${i}`, reason: 'answer' } as never)
  }
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^  0 running · 50 done$/ })).toBeDefined()
  expect((await ui.findAll({ text: /^▐\^_\^▌✓ +\d+: / })).map(r => r.text.split(' -')[0])).toEqual(['▐^_^▌✓  52: Job 52', '▐^_^▌✓  51: Job 51', '▐^_^▌✓  50: Job 50'])
})

test('a TaskCreate task shows its number on the current line', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_$, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '7', subject: 'x' } } : {} }) as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Ship', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▸ #7 Ship$/ })).toBeDefined()
})

test('header shows working while an agent runs after the main turn ended', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Background scan' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working$/ })).toBeDefined()
})

test('a new plan shows once every todo is done', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [ ] a\n### Task 2: B\n- [ ] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '1', subject: 'x' } } : {} }) as never)

  await $.tool.call({ tool: 'TaskCreate', subject: 'Old', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/2$/ })).toBeDefined()
})

test('an agent waiting on its background work stays running, and a resumed one runs again', async ($, on) => {
  mock.clock(on)
  const status: Record<string, string> = { A1: 'waiting', A2: 'completed' }
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description === 'Scan' ? 'A1' : 'A2' }))
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, status: s, description: '', type: 'general-purpose' })) }) as never)
  on('turn.step', async function* () { return { answer: '', toolUses: [] } as never })
  on('turn.complete', () => ({ text: '' }))
  const end = (agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId, reason: 'answer' } as never)

  await $.agent.spawn({ prompt: 'p', description: 'Scan' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Lint' } as never)
  await end('A1')
  await end('A2')
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐-_-▌z +1: Scan / })).toBeDefined()
  expect(await ui.find({ text: /^▐\^_\^▌✓ +2: Lint / })).toBeDefined()
  expect(await ui.find({ text: /^  1 running · 1 done$/ })).toBeDefined() // waiting counts as running
  await ui.unmount()

  // A2 is woken again: its next step puts it back to running
  for await (const _ of $.turn.step({ agentId: 'A2', model: 'claude-haiku-5-5' } as never)) void _
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐•_•▌ ?» +2: Lint / })).toBeDefined()
})

test('finish shows on the pipeline until another plan starts a new cycle', async ($, on) => {
  mock.clock(on)
  const B = '/r/docs/superpowers/plans/2026-02-01-next.md'
  on('fs.read', (_$, e) => (e.path === SP || e.path === B ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))

  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await $.tool.call({ tool: 'Read', file_path: SP } as never) // the same plan again: still finishing
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^● finish$/ })).toBeDefined() // finish never shows a time
  await ui.unmount()

  await $.tool.call({ tool: 'Write', file_path: B, content: '' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^● plan +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ finish$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ brainstorm$/ })).toBeDefined() // a new cycle: the earlier stages it skipped carry no time
})

const sdd = (answer = '') => ({ answer, durationMs: 0, isAborted: false, turnId: 'T', reason: 'answer' }) as never

test('superpowers section: hidden until a superpowers skill, then pipeline and path badge', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'commit', text: '' })
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /SUPERPOWERS/ })).toBeUndefined()
  await ui.unmount()

  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
  expect(await ui.find({ text: /^● brainstorm +\d\d:\d\d$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete(sdd('A quick spike would show whether this works. Want me to try one?'))
  await $.skill.prompt({ skill: 'superpowers:test-driven-development', text: '' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^SPIKE$/ })).toBeDefined()
  expect(await ui.find({ text: /^● brainstorm +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^\+ tdd$/ })).toBeDefined()
  await ui.unmount()

  // past brainstorming a reply no longer moves the badge
  await $.skill.prompt({ skill: 'superpowers:executing-plans', text: '' })
  await $.turn.complete(sdd('this looks bounded after all'))
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^SPIKE$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ brainstorm +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^● execute +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ spec/ })).toBeUndefined() // a spike draws only what it reached
})

test('a spec without a size draws the full line, no badge', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }) as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.tool.call({ tool: 'Write', file_path: '/r/docs/superpowers/specs/2026-01-01-x-design.md', content: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^(SMALL|PROJECT|SPIKE)$/ })).toBeUndefined()
  expect(await ui.find({ text: /^○ finish$/ })).toBeDefined()
})

test('a small change stays small through its spec', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.turn.complete(sdd('작은 변경이라 짧은 design doc을 쓸게요'))
  await $.tool.call({ tool: 'Write', file_path: '/r/docs/superpowers/specs/2026-01-01-x-design.md', content: '' } as never)
  await $.turn.complete(sdd('a spike could help here'))
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^SMALL$/ })).toBeDefined()
})

test('SDD agents show by role under superpowers, not under agents', async ($, on) => {
  mock.clock(on)
  const ids: Record<string, string> = { 'Implement Task 4: Wire detector': 'I4', 'Review Task 3 (spec + quality)': 'R3', 'Explore auth': 'X1' }
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: ids[e.description] }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (const description of Object.keys(ids)) await $.agent.spawn({ prompt: 'p', description } as never)
  await $.turn.complete({ ...(sdd('**Task quality:** Needs fixes') as object), agentId: 'R3' } as never)

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐•_•▌[⚙✲] +impl #4 +Haiku 5\.5 00:00$/ })).toBeDefined()
  expect(await ui.find({ text: /^▐o_o▌⚠ +review #3 +issues 00:00$/ })).toBeDefined()
  // AGENTS lists only the plain one, but counts all three
  expect(await ui.find({ text: /^  2 running · 1 done$/ })).toBeDefined()
  expect(await ui.find({ text: /^▐•_•▌ ?» +3: Explore au… / })).toBeDefined()
  expect(await ui.find({ text: /\d: (Implement|Review) Task/ })).toBeUndefined()
})

test('review waits for the plan to be done', async ($, on) => {
  mock.clock(on)
  let plan = '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n'
  on('fs.read', (_$, e) => (e.path === SP ? { value: plan } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description }))
  const current = async () => {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    const found = await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (execute|review)\b/ })
    await ui.unmount()
    return found?.text.match(/^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (execute|review)\b/)?.[1]
  }
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Review the change' } as never)
  expect(await current()).toBe('execute')
  await $.skill.prompt({ skill: 'superpowers:receiving-code-review', text: '' })
  expect(await current()).toBe('execute')

  plan = plan.replace('- [ ] b', '- [x] b')
  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Final whole-branch review' } as never)
  expect(await current()).toBe('review')
})

test('a skill a subagent loads never moves the stage', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Skill') await $.skill.prompt({ skill: 'superpowers:requesting-code-review', text: '' })
    return { result: {} } as never
  })
  const current = async () => {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    const found = await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (execute|review)\b/ })
    await ui.unmount()
    return found?.text.match(/^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (execute|review)\b/)?.[1]
  }
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:requesting-code-review', agentId: 'A1' } as never)
  expect(await current()).toBe('execute')
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:requesting-code-review' } as never)
  expect(await current()).toBe('review')
})

test('a narrow pane keeps the current stage row and folds skills instead of overflowing', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['brainstorming', 'writing-plans', 'using-git-worktrees', 'subagent-driven-development', 'requesting-code-review'])
    await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
  const W = 30 // the pane never draws narrower
  expect(await ui.find({ text: /^● review +\d\d:\d\d$/ })).toBeDefined()
  expect((await ui.find({ text: /^… → .*requesting-code-review$/ }))?.text.length).toBeLessThanOrEqual(W - 4)
})

test('a narrow pane keeps the current stage row', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['writing-plans', 'subagent-driven-development']) await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^● execute +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ review$/ })).toBeDefined()
})

test('timeline nests the plan bar and role agents under execute', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n### Task 3: C\n- [ ] c\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'I2' }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Implement Task 2: x' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  // the card: the stage and its time right of the character, the bar below
  expect((await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] execute +\d\d:\d\d$/ }))?.text.length).toBe(28) // W - 4 - character 12 - gap 2
  expect((await ui.find({ text: /▝▜█████▛▘.* 1\/3$/ }))?.text.length).toBe(42) // W - 4: the count sits on the right edge
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^  │ $/ })).toBeDefined()
  expect(await ui.find({ text: /^▐•_•▌[⚙✲] +impl #2 +Haiku 5\.5 00:00$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ review$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ finish$/ })).toBeDefined()
})

test('a narrow pane cuts labels, keeps times', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['brainstorming', 'writing-plans', 'subagent-driven-development']) await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
  const rows = await ui.findAll({ type: 'Text', text: /^[✓○●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (brainstorm|spec|plan|execute|review|finish)/ })
  expect(rows.length).toBe(6)
  for (const r of rows) expect(r.text.length).toBeLessThanOrEqual(26)
  expect(await ui.find({ text: /^✓ brainstorm +\d\d:\d\d$/ })).toBeDefined()
})

test('a running role agent without a task number stays in view after many tasks', async ($, on) => {
  mock.clock(on)
  let k = 0
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (let n = 1; n <= 3; n++) {
    for (const d of [`Implement Task ${n}: x`, `Review Task ${n} (spec + quality)`]) {
      await $.agent.spawn({ prompt: 'p', description: d } as never)
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: `A${k}`, reason: 'answer' } as never)
    }
  }
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  // working first, then the latest spawned
  expect((await ui.findAll({ text: /^▐\S{3}▌ ?\S +(review|impl) [#A-Z]/ })).map(r => unbit(r.text).split(/ {2,}/)[0])).toEqual([
    expect.stringMatching(/^▐•_•▌⌕ review Re…$/),
    '▐^_^▌✓ review #3',
    '▐^_^▌✓ impl #3',
    '▐^_^▌✓ review #2',
    '▐^_^▌✓ impl #2',
  ])
})

test('agents spawned outside superpowers get no role', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐•_•▌ ?» +1: Review diff / })).toBeDefined()
})

test('activity shows alongside open tasks', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {} }) as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'in_progress')] } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push branch' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▸ aing$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ Bash · Push branch$/ })).toBeDefined()
})

test('a tool call that throws settles its activity row as ✗', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => {
    throw new Error('boom')
  })
  await $.tool.call({ tool: 'Bash', command: 'x', description: 'Explodes' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✗ Bash · Explodes$/ })).toBeDefined()
})

test('a review without a task number in its description takes none from its prompt', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'D1' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.agent.spawn({ prompt: 'The plan says: ### Task 3: Parser', description: 'Review spec document' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐•_•▌ ?⌕ +review Re… / })).toBeDefined() // cut 4 earlier behind the guide
  expect(await ui.find({ text: /review #3/ })).toBeUndefined()
})

test('after finish, a plain review agent lists under AGENTS again', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐•_•▌ ?» +1: Review diff / })).toBeDefined()
})

test("SDD's whole-branch reviewer reaches the review stage", async ($, on) => {
  mock.clock(on)
  let k = 0
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Review Task 1 (spec + quality)' } as never)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] execute +\d\d:\d\d$/ })).toBeDefined() // a per-task review is still execute (spinning: agents run)
  await ui.unmount()
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓ execute +\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] review +\d\d:\d\d$/ })).toBeDefined()
})

test("7.0.0 brainstorming's builder check shows as a review under superpowers", async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'B1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.agent.spawn({ prompt: 'You are a talented software engineer…', description: 'Builder check' } as never)
  await $.turn.complete({ ...(sdd('nothing important left') as object), agentId: 'B1' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▐\^_\^▌✓ +review Bui… +approved 00:00$/ })).toBeDefined()
  expect(await ui.find({ text: /^AGENTS$/ })).toBeUndefined()
})

test('dur reads mm:ss, then h:mm:ss from an hour', () => {
  expect(dur(65_000)).toBe('01:05')
  expect(dur(3_725_000)).toBe('1:02:05')
})

test('shimmer: the bright cell walks across the text and merges runs', () => {
  const tones = (f: number) => shimmer('abcdefghij', f).map(s => `${s.tone}:${s.text}`)
  expect(tones(4)).toEqual(['hi:a', 'mid:bc', 'base:defghij'])
  expect(tones(8)).toEqual(['base:ab', 'mid:cd', 'hi:e', 'mid:fg', 'base:hij'])
  expect(tones(0)).toEqual(['base:abcdefghij']) // inside the gap
  expect(shimmer('abcdefghij', 8).map(s => s.text).join('')).toBe('abcdefghij')
})

test('phaseOf reads fix and re-review from the label', () => {
  const run = (label: string, role: 'impl' | 'review') => ({ n: 1, label, model: '', startedAt: 0, status: 'running' as const, role })
  expect(phaseOf(run('Implement Task 2: x', 'impl'))).toBe('impl')
  expect(phaseOf(run('Fix Task 2 review findings', 'impl'))).toBe('fix')
  expect(phaseOf(run('Review Task 2 (spec + quality)', 'review'))).toBe('review')
  expect(phaseOf(run('Re-review Task 2 fixes', 'review'))).toBe('re-review')
})

test('the current task line ends with the phase of its running agent', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: A\n- [ ] a\n### Task 2: Wire it\n- [ ] b\n### Task 3: C\n- [ ] c\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n- Task 1: complete (x)\n- Task 2: dispatched\n',
  }
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  const ids: Record<string, string> = { 'Implement Task 2: Wire it': 'I2', 'Review Task 2 (spec + quality)': 'R2' }
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: ids[e.description] }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })

  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #2 Wire it$/ })).toBeDefined() // idle: no shimmer spinner, no phase yet
  await ui.unmount()

  await $.agent.spawn({ prompt: 'p', description: 'Implement Task 2: Wire it' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] #2 Wire it +impl 00:00$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ ...(sdd('DONE') as object), agentId: 'I2' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Review Task 2 (spec + quality)' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] #2 Wire … +review 00:00$/ })).toBeDefined() // the card's right column cuts the label
})

test('a long current task is cut to the pane before it shimmers', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: A\n- [ ] a\n### Task 2: Wire the very long detector name through every layer\n- [ ] b\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n- Task 2: dispatched\n',
  }
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  const narrow = { ...pane, props: { ...pane.props, bodyColumns: 30 }, surface: 'terminal' }

  let ui = await $.ui.mount(narrow as never)
  let line = await ui.find({ text: /^▸ #2 Wire/ })
  expect(line?.text.length).toBe(22) // W 30 - 4 border/padding - 4 guide
  expect(line?.text.endsWith('…')).toBe(true)
  await ui.unmount()

  await $.turn.start({ text: 'go', turnId: 'T1' })
  ui = await $.ui.mount(narrow as never)
  line = await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] #2 Wire.*…$/ })
  expect(line?.text.length).toBe(22)
})

test('each stage keeps its agents: issues first, 5 rows, then … more', async ($, on) => {
  const clock = mock.clock(on)
  let k = 0
  on('fs.read', (_$, e) => (e.path === SP ? { value: [1, 2, 3, 4, 5, 6].map(n => `### Task ${n}: T\n- [x] a\n`).join('') } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  const done = (answer = '') => $.turn.complete({ ...(sdd(answer) as object), agentId: `A${k}` } as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Builder check' } as never)
  await done('nothing important left')
  await clock.advance(1000)
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (let n = 1; n <= 6; n++) {
    await $.agent.spawn({ prompt: 'p', description: `Implement Task ${n}: x` } as never)
    await done()
    await $.agent.spawn({ prompt: 'p', description: `Review Task ${n} (spec + quality)` } as never)
    await done(n === 1 ? '**Task quality:** Needs fixes' : 'Approved')
  }
  await clock.advance(1000)
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  await done('Approved')
  await clock.advance(1000)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, scroll: { offset: 0, bodyRows: 60 } }, surface: 'terminal' } as never)
  const rows = (await ui.findAll({ type: 'Text', text: /^(. (brainstorm|spec|plan|execute|review|finish)\b|▐\S{3}▌ ?\S +(impl|review) |  … \d+ more$)/ })).map(r => unbit(r.text).trim().split(/ {2,}/)[0])
  expect(rows).toEqual([
    '✓ brainstorm',
    '▐^_^▌✓ review Bui…',
    '✓ spec',
    '✓ plan',
    expect.stringMatching(/^✓ execute █+ 6\/6 /),
    '✓ execute', // the execute row's label part
    '▐o_o▌⚠ review #1',
    '▐^_^▌✓ review #6',
    '▐^_^▌✓ impl #6',
    '▐^_^▌✓ review #5',
    '▐^_^▌✓ impl #5',
    '… 7 more',
    '✓ review',
    expect.stringMatching(/^▐\^_\^▌✓ review Re/),
    expect.stringMatching(/^. finish$/),
  ])
})

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

test('main panel shows the version', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  // a Box's text holds its children's: the Text itself carries the dim
  expect((await ui.find({ type: 'Text', text: /v1\.2\.0/ }))?.props.dimColor).toBe(true)
})

test('the main header fits a narrow pane: the version drops when it does not fit', async ($, on) => {
  mock.clock(on)
  on('turn.step', async function* () { return { answer: '', toolUses: [] } as never })
  for await (const _ of $.turn.step({ model: 'claude-sonnet-4-6' } as never)) void _
  for (const [cols, shown] of [[30, false], [46, true]] as const) {
    const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: cols }, surface: 'terminal' } as never)
    const head = await ui.find({ type: 'Box', text: /· main.*○ idle( +v[\d.]+)?$/ })
    expect(head?.text.length).toBeLessThanOrEqual(cols - 4)
    expect(!!(await ui.find({ type: 'Text', text: /v1\.2\.0/ }))).toBe(shown)
    await ui.unmount()
  }
})

const TWO = '### Task 1: Code\n**Files:**\n- Modify: `src/a.ts`\n- [ ] a\n### Task 2: Docs\n**Files:**\n- Modify: `AGENTS.md`\n- [ ] b\n'
const executing = async (...[$, on, result]: [...Parameters<TestBody>, unknown]) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: TWO } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result }) as never)
  on('skill.prompt', () => ({ text: '' }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:executing-plans', text: '' })
}
const currentLine = async ($: Parameters<TestBody>[0]) => {
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  const line = (await ui.find({ text: /^▸ #/ }))?.text
  await ui.unmount()
  return line
}

test("a Bash edit of a task's file makes it current", async ($, on) => {
  await executing($, on, {})
  await $.tool.call({ tool: 'Bash', command: "sed -i '' 's/x/y/' AGENTS.md" } as never)
  expect(await currentLine($)).toMatch(/^▸ #2/)
})

test('bashEditDiff wins over the command parse', async ($, on) => {
  await executing($, on, { bashEditDiff: { changedFiles: ['/r/src/a.ts'] } })
  await $.tool.call({ tool: 'Bash', command: 'python3 fix.py' } as never)
  expect(await currentLine($)).toMatch(/^▸ #1/)
})

test('an untied edit in execute gets the warning once', async ($, on) => {
  await executing($, on, {})
  const a = await $.tool.call({ tool: 'Edit', file_path: '/r/notes.md', old_string: 'a', new_string: 'b' } as never)
  const b = await $.tool.call({ tool: 'Edit', file_path: '/r/notes.md', old_string: 'a', new_string: 'b' } as never)
  expect(a.context ?? []).toContain(WARN)
  expect(b.context ?? []).not.toContain(WARN)
  expect(a.deny).toBeUndefined()
  expect(b.deny).toBeUndefined()
})

test('0.9.x atoms left from a hot reload are ignored', async ($, on) => {
  mock.clock(on)
  // what 0.9.x stored under its own keys stays through the reload
  on('state.get', (_$, e, next) => (['plan', 'sp', 'main', 'agents'].includes((e as { key: string }).key) ? ({ value: { value: { junk: 1 }, version: 1 } } as never) : next(e)))
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /· main$/ })).toBeDefined()
})

const toExecute = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n### Task 3: C\n- [ ] c\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'I2' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Implement Task 2: x' } as never)
}

test('the current stage draws its character card in the terminal', async ($, on) => {
  await toExecute($, on)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /▄███▄/ })).toBeDefined() // 건설공 안전모
  expect(await ui.find({ text: /▐▛███▜▌/ })).toBeDefined()
  for (const t of await ui.findAll({ type: 'Text' })) expect([...t.text].length).toBeLessThanOrEqual(42)
})

test('a non-execute stage card fits the terminal pane', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /꿈꾸는 현자/ })).toBeDefined()
  const name = (await ui.findAll({ text: /^꿈꾸는 현자$/ })).find(t => t.props.bold)
  expect(name?.props.dimColor).toBeFalsy()
  expect(name).toBeDefined()
  for (const t of await ui.findAll({ type: 'Text' })) expect([...t.text].length).toBeLessThanOrEqual(42)
})

test('on desktop a done execute row beside its sprite keeps its count and time', async ($, on) => {
  await toExecute($, on)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  const row = await ui.find({ text: /^✓ execute ?[^│]*$/ })
  expect(row?.text).toMatch(/ ?\d\/3 \d\d:\d\d$/)
  expect([...row!.text].length).toBeLessThanOrEqual(46 - 4 - 4)
})

test('desktop draws stage and agent sprites as Svg with alt text', async ($, on) => {
  await toExecute($, on)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  expect(alts).toContain('execute · 망치 대장장이')
  expect(alts).toContain('impl running')
  expect(alts.some(a => /^brainstorm · /.test(a))).toBe(true) // 끝난 단계는 1배 정지 캐릭터
})

test('narrow pane falls back to the plain stage row', async ($, on) => {
  await toExecute($, on)
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 34 }, surface: 'terminal' } as never)
  expect(await ui.find({ text: /▐▛███▜▌/ })).toBeUndefined()
  expect(await ui.find({ text: /execute/ })).toBeDefined()
})

test('a plain agent under AGENTS draws as a green bit', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Explore auth' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect((await ui.find({ text: /^▐$/ }))?.props.color).toBe('#1D9E75')
  expect((await ui.findAll({ text: /^•_•$/ }))[0]?.props.backgroundColor).toBe('#D97757')
})

test('a plain agent under AGENTS draws as a green-hatted Clawd on desktop', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Explore auth' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  const svg = (await ui.findAll({ type: 'Svg' })).find(s => s.props.alt === 'agent running')
  expect(String(svg?.props.source)).toContain('#1D9E75')
  expect(String(svg?.props.source)).toContain('#D97757')
})

test('on desktop the execute bar is an Svg that fits the row, on a wide or a narrow pane', async ($, on) => {
  await toExecute($, on)
  for (const bodyColumns of [46, 34]) {
    const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns }, surface: 'desktop' } as never)
    expect((await ui.findAll({ type: 'Svg' })).filter(s => /^\d+\/3$/.test(String(s.props.alt)))).toHaveLength(1)
    expect(await ui.find({ text: /[█▓░]/ })).toBeUndefined()
    expect(await ui.find({ text: /\d\/3/ })).toBeDefined()
    await ui.unmount()
  }
})

test('sections and superpowers stages are spaced with a sm gap (0 rows in the terminal)', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface } as never)
    expect((await ui.find({ type: 'Box' }))?.props.gap).toBe('sm')
    const stages = (await ui.findAll({ type: 'Box' })).filter(b => b.props.gap === 'sm' && /brainstorm/.test(b.text) && !/main/.test(b.text))
    expect(stages).toHaveLength(1)
    await ui.unmount()
  }
})

test('on desktop a done execute row gives its bar room to stretch', async ($, on) => {
  await toExecute($, on)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  const grow = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexGrow === 1 && /^✓ execute ?[^│]*$/.test(b.text))
  expect(grow.length).toBeGreaterThan(0)
})

test('on desktop the bar row is spaced by its gap alone, no padding spaces', async ($, on) => {
  await toExecute($, on)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /^✓ execute$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d\/3 \d\d:\d\d$/ })).toBeDefined()
})

test('the stage card opens with its nickname, execute too, then head, bar and task', async ($, on) => {
  await toExecute($, on)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect((await ui.find({ text: /▄███▄/ }))?.text).toContain('망치 대장장이')
  expect((await ui.find({ text: /▐▛███▜▌/ }))?.text).toMatch(/execute/)
  for (const t of await ui.findAll({ type: 'Text' })) expect([...t.text].length).toBeLessThanOrEqual(42)
  await ui.unmount()
  ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^망치 대장장이$/ }))?.props.bold).toBe(true)
})
