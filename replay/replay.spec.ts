import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Ev } from '../hooks/ev'
import { parsePlan } from '../hooks/plan'
import { INIT, step } from '../hooks/state'
import { check } from './check'
import { fromTranscript } from './fromTranscript'

// tiny synthetic transcript records: no real data
const T = '2026-01-01T00:00:00.000Z'
const use = (id: string, name: string, input: object) => JSON.stringify({ type: 'assistant', timestamp: T, cwd: '/r', message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, toolUseResult: unknown, content = '') =>
  JSON.stringify({ type: 'user', timestamp: T, cwd: '/r', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult })
const PLAN = '/r/docs/superpowers/plans/2026-01-01-x.md'
const TEXT = '### Task 1: One\n- [ ] a\n### Task 2: Two\n- [ ] b\n'
const none = () => undefined
const fold = (evs: Ev[]) => evs.reduce((s, ev) => step(s, ev).s, INIT)

describe('converter', () => {
  test('a written plan, executing-plans and a task-done ledger line complete Task 1', () => {
    const { evs, skipped } = fromTranscript(
      [
        use('w', 'Write', { file_path: PLAN, content: TEXT }),
        result('w', { type: 'create', filePath: PLAN, content: TEXT }),
        use('s', 'Skill', { skill: 'superpowers:executing-plans' }),
        result('s', { success: true, commandName: 'superpowers:executing-plans' }),
        use('d', 'Bash', { command: 'task-done docs/superpowers/plans/2026-01-01-x.md 1 abc -- bun test' }),
        result('d', { stdout: 'ok\nledger: Task 1: complete (commits a..b, tests: bun test → ok)', stderr: '' }),
      ],
      none,
      none,
    )
    expect(skipped).toBeUndefined()
    const s = fold(evs)
    expect(s.sp.current).toBe('execute')
    expect(s.plan.tasks.map(t => t.status)).toEqual(['completed', 'in_progress'])
  })

  test('a non-JSON line and an unknown type are skipped without a throw', () => {
    const { evs, skipped } = fromTranscript(['not json', JSON.stringify({ type: 'mystery', timestamp: T })], none, none)
    expect(evs).toEqual([])
    expect(skipped).toBe('no plan')
  })

  test('a plan first seen in a Bash command with no plan text reads the disk', () => {
    const disk = (p: string) => (p === PLAN ? TEXT : undefined)
    const { evs } = fromTranscript([use('c', 'Bash', { command: 'cat docs/superpowers/plans/2026-01-01-x.md' }), result('c', { stdout: '', stderr: '' })], none, disk)
    expect(evs.filter(e => e.t === 'file')).toEqual([{ t: 'file', at: Date.parse(T), path: PLAN, text: TEXT }])
  })

  test('a ledger created through shell variables still owns the active plan', () => {
    const { evs } = fromTranscript(
      [
        use('w', 'Write', { file_path: PLAN, content: TEXT }),
        result('w', {}),
        use('h', 'Bash', { command: 'echo "# SDD ledger — plan: $PLAN" > "$W/progress.md" && echo "Task 1: complete" >> "$W/progress.md"' }),
        result('h', {}),
      ],
      none,
      none,
    )
    expect(fold(evs).plan.tasks[0]?.status).toBe('completed')
  })

  test('an Edit of the plan applies to the last known text', () => {
    const { evs } = fromTranscript(
      [
        use('w', 'Write', { file_path: PLAN, content: TEXT }),
        result('w', {}),
        use('e', 'Edit', { file_path: PLAN, old_string: '- [ ] a', new_string: '- [x] a' }),
        result('e', {}),
      ],
      none,
      none,
    )
    expect(fold(evs).plan.tasks[0]?.status).toBe('completed')
  })
})

describe('check', () => {
  const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
  const LEDGER = '/r/.superpowers/sdd/2026-01-01-x/progress.md'
  const HEAD = '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n'
  const call = (id: string, tool: string, input: object, edited: string[] = []): Ev[] => [
    { t: 'tool.start', at: 1, id, tool, input },
    { t: 'tool.end', at: 2, id, tool, input, ok: true, edited },
  ]
  const planned = (text: string): Ev[] => [...call('w', 'Write', { file_path: SP }), { t: 'file', at: 3, path: SP, text }]
  const skill: Ev = { t: 'skill', at: 10, name: 'executing-plans', fromSubagent: false }
  const ledger = (text: string): Ev => ({ t: 'file', at: 4, path: LEDGER, text: HEAD + text })

  test('a later ledger that drops a completion is I2 when the fold loses it', () => {
    const evs = [...planned(TEXT), skill, ledger('Task 1: complete\n'), ledger('')]
    // a reducer without keep-completed: the ledger alone decides
    const forgetful = (s: typeof INIT, ev: Ev) => {
      const r = step(s, ev)
      return ev.t === 'file' && ev.path === LEDGER ? { ...r, s: { ...r.s, plan: { ...r.s.plan, tasks: parsePlan(r.s.plan.text, ev.text) } } } : r
    }
    expect(check(evs, forgetful).violations).toEqual([
      { kind: 'I2', at: 5 },
      { kind: 'I3', at: 5 },
    ])
    // the real reducer keeps it
    expect(check(evs).violations).toEqual([])
  })

  test('the vee-app shape: nothing to report, the edit is linked', () => {
    const plan = '### Task 1: Seed\n**Files:**\n- Modify: `src/seed.ts`\n- [ ] a\n### Task 2: Docs\n**Files:**\n- Modify: `AGENTS.md`\n- [ ] b\n'
    const r = check([...planned(plan), skill, ledger('Task 1: Ruling: skip seeding\n'), ...call('b', 'Bash', { command: "sed -i '' 's/x/y/' AGENTS.md" }, ['/r/AGENTS.md'])])
    expect(r).toEqual({ violations: [], linked: 1, edits: 1 })
  })

  test('an unlinked edit with no warning in its gap is I1; the warning covers the gap', () => {
    const evs = [...planned(TEXT), skill, ...call('e', 'Edit', { file_path: '/r/x.ts' }, ['/r/x.ts']), ...call('f', 'Edit', { file_path: '/r/y.ts' }, ['/r/y.ts'])]
    expect(check(evs)).toEqual({ violations: [], linked: 0, edits: 2 })
    const mute = (s: typeof INIT, ev: Ev) => ({ ...step(s, ev), effects: [] })
    expect(check(evs, mute).violations).toEqual([
      { kind: 'I1', at: 5 },
      { kind: 'I1', at: 7 },
    ])
  })

  test('the final count short of the ledger is I3; a throw is I4', () => {
    const evs = [...planned(TEXT), skill, ledger('Task 1: complete\n')]
    const deaf = (s: typeof INIT, ev: Ev) => (ev.t === 'file' && ev.path === LEDGER ? { s, effects: [] } : step(s, ev))
    expect(check(evs, deaf).violations).toEqual([{ kind: 'I3', at: 4 }])
    const boom = (s: typeof INIT, ev: Ev) => (ev.t === 'skill' ? (() => { throw new Error('x') })() : step(s, ev))
    expect(check(evs, boom).violations).toEqual([{ kind: 'I4', at: 3 }])
  })
})

// the local corpus: each session folds through the reducer; only basenames, kinds, indexes and counts are printed
const DIR = process.env.REPLAY_DIR ?? join(homedir(), '.claude', 'projects')
const WANT = /superpowers:(executing-plans|subagent-driven-development)/
const sessions = existsSync(DIR)
  ? readdirSync(DIR, { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.jsonl') && !f.includes('/subagents/'))
      .map(f => join(DIR, f))
      .filter(f => WANT.test(readFileSync(f, 'utf8')))
  : []
const readOr = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined)

describe('replay', () => {
  if (sessions.length === 0) test.skip('no local sessions', () => {})
  for (const file of sessions) {
    const name = basename(file)
    test(name, () => {
      const lines = (p: string) => readOr(p)?.split('\n')
      let out: ReturnType<typeof fromTranscript>
      try {
        out = fromTranscript(lines(file)!, id => lines(join(file.slice(0, -'.jsonl'.length), 'subagents', `agent-${id}.jsonl`)), readOr)
      } catch {
        throw new Error('I4@convert')
      }
      if (out.skipped) return void console.log(`${name} skipped: ${out.skipped}`)
      const r = check(out.evs)
      const pct = r.edits ? Math.round((100 * r.linked) / r.edits) : 100
      console.log(`${name} ${r.linked}/${r.edits} (${pct}%)`)
      if (r.violations.length) throw new Error(r.violations.map(v => `${v.kind}@${v.at}`).join(' '))
    })
  }
})
