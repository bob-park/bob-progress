import { expect, test } from 'claude-code/testing'
import { BOT_W, botFrame, botKind, botStatus, STAGE_W, stageFrame } from './characters'
import { ORDER } from './superpowers'

const width = (segs: { text: string }[]) => segs.reduce((n, s) => n + [...s.text].length, 0)
const run = (over: object) => ({ n: 1, label: 'x', model: '', startedAt: 0, status: 'running', ...over }) as never

test('stageFrame: every stage draws 4 lines of STAGE_W cells on every frame', () => {
  for (const s of ORDER) for (let f = 0; f < 30; f++) {
    const lines = stageFrame(s, f, true)
    expect(lines).toHaveLength(4)
    for (const l of lines) expect(width(l)).toBe(STAGE_W)
  }
})

test('stageFrame: still when not working, moving when working', () => {
  for (const s of ORDER) {
    expect(stageFrame(s, 17, false)).toEqual(stageFrame(s, 0, false))
    const seen = new Set(Array.from({ length: 30 }, (_, f) => JSON.stringify(stageFrame(s, f, true))))
    expect(seen.size).toBeGreaterThan(1)
  }
})

test('stageFrame: feet swap every 5 frames, props every 3', () => {
  const feet = (f: number) => stageFrame('execute', f, true)[3]![0]!.text
  expect(feet(0)).toBe('  ▘▘ ▝▝  ')
  expect(feet(5)).toBe('  ▝▝ ▘▘  ')
  expect(stageFrame('execute', 2, true)[1]![1]).toEqual(stageFrame('execute', 0, true)[1]![1])
  expect(stageFrame('execute', 3, true)[1]![1]).not.toEqual(stageFrame('execute', 0, true)[1]![1])
})

test('botFrame: one glyph per status, BOT_W cells wide', () => {
  expect(botFrame('impl', 0, 'running').text.trimEnd()).toBe('[•_•]⚙')
  expect(botFrame('impl', 3, 'running').text.trimEnd()).toBe('[•_•]✲')
  expect(botFrame('review', 0, 'waiting').text.trimEnd()).toBe('[-_-]z')
  expect(botFrame('fix', 0, 'done').text.trimEnd()).toBe('[^_^]✓')
  expect(botFrame('agent', 0, 'failed').text.trimEnd()).toBe('[x_x]✗')
  expect(botFrame('review', 0, 'issues').text.trimEnd()).toBe('[o_o]⚠')
  for (const st of ['waiting', 'done', 'failed', 'issues'] as const) expect(botFrame('impl', 7, st)).toEqual(botFrame('impl', 0, st))
  for (const k of ['impl', 'review', 'fix', 'agent'] as const) for (let f = 0; f < 6; f++) expect([...botFrame(k, f, 'running').text].length).toBe(BOT_W)
})

test('botKind and botStatus read role, phase and verdict; failed beats issues', () => {
  expect(botKind(run({ role: 'impl' }))).toBe('impl')
  expect(botKind(run({ role: 'impl', label: 'fix #2' }))).toBe('fix')
  expect(botKind(run({ role: 'review', label: 're-review #2' }))).toBe('review')
  expect(botKind(run({}))).toBe('agent')
  expect(botStatus(run({ status: 'done', verdict: 'issues' }))).toBe('issues')
  expect(botStatus(run({ status: 'failed', verdict: 'issues' }))).toBe('failed')
  expect(botStatus(run({ status: 'waiting' }))).toBe('waiting')
})
