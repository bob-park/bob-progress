import { expect, test } from 'claude-code/testing'
import type { Seg } from './characters'
import { BOT_W, botFrame, botKind, botStatus, botSvg, STAGE_W, stageFrame, stageSvg } from './characters'
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

test('botFrame: a one-line little Clawd, face on clay, BOT_W cells, one face per status', () => {
  const txt = (s: Seg[]) => s.map(x => x.text).join('')
  expect(txt(botFrame('impl', 0, 'running')).trimEnd()).toBe('▐•_•▌⚙')
  expect(txt(botFrame('impl', 3, 'running')).trimEnd()).toBe('▐•_•▌✲')
  expect(txt(botFrame('review', 0, 'waiting')).trimEnd()).toBe('▐-_-▌z')
  expect(txt(botFrame('fix', 0, 'done')).trimEnd()).toBe('▐^_^▌✓')
  expect(txt(botFrame('agent', 0, 'failed')).trimEnd()).toBe('▐x_x▌✗')
  expect(txt(botFrame('review', 0, 'issues')).trimEnd()).toBe('▐o_o▌⚠')
  expect(botFrame('impl', 0, 'running')[1]).toEqual({ text: '•_•', color: '#1F1E1D', bg: '#D97757' })
  expect(botFrame('fix', 0, 'done')[3]!.color).toBe('success')
  for (const st of ['waiting', 'done', 'failed', 'issues'] as const) expect(botFrame('impl', 7, st)).toEqual(botFrame('impl', 0, st))
  for (const k of ['impl', 'review', 'fix', 'agent'] as const) for (let f = 0; f < 6; f++) expect([...txt(botFrame(k, f, 'running'))].length).toBe(BOT_W)
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

test('stageSvg: same input, same markup; animates only when on; honours reduced motion', () => {
  for (const s of ORDER) {
    const a = stageSvg(s, 4, true)
    expect(a).toEqual(stageSvg(s, 4, true))
    expect(a.source.startsWith('<svg')).toBe(true)
    expect(a.source.length).toBeLessThan(131072)
    expect(a.source).toContain('prefers-reduced-motion')
    expect(a.source).toContain('<svg class="tp on"')
    expect(stageSvg(s, 4, false).source).toContain('<svg class="tp"')
    expect([a.width, a.height]).toEqual([100, 60])
  }
})

test('botSvg: moves only while running; status marks for done, failed, issues', () => {
  expect(botSvg('impl', 2, 'running').source).toContain('<svg class="tp on"')
  for (const st of ['waiting', 'done', 'failed', 'issues'] as const) expect(botSvg('impl', 2, st).source).toContain('<svg class="tp"')
  expect(botSvg('impl', 2, 'done').source).not.toEqual(botSvg('impl', 2, 'failed').source)
  expect(botSvg('impl', 2, 'issues').source).not.toEqual(botSvg('impl', 2, 'done').source)
  expect([botSvg('fix', 2, 'done').width, botSvg('fix', 2, 'done').height]).toEqual([36, 20])
})

test('sprite CSS is scoped under the root class, so an inlined svg leaks nothing', () => {
  const css = stageSvg('execute', 1, true).source.match(/<style>([\s\S]*?)<\/style>/)![1]!
  // every selector outside @keyframes/@media blocks; @media's inner rules too
  const sels = css.replace(/@keyframes \w+\{(?:[^{}]*\{[^{}]*\})*\}/g, '').replace(/@media[^{]*\{/g, '').match(/[^{}]+(?=\{)/g)!
  expect(sels.length).toBeGreaterThan(10)
  for (const sel of sels) for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.tp[ .]/)
})

test('botSvg: a little Clawd in its role colour, one face per status', () => {
  expect(botSvg('impl', 2, 'running').source).toContain('#D97757')
  expect(botSvg('impl', 2, 'running').source).toContain('#378ADD')
  expect(botSvg('agent', 2, 'done').source).toContain('#1D9E75')
  const faces = new Set((['running', 'waiting', 'done', 'failed', 'issues'] as const).map(s => botSvg('impl', 2, s).source))
  expect(faces.size).toBe(5)
  expect(botSvg('review', 2, 'running')).toEqual(botSvg('review', 2, 'running'))
})

test('only moving sprites draw as an interactive frame', () => {
  expect(botSvg('impl', 2, 'running').isInteractive).toBe(true)
  for (const st of ['waiting', 'done', 'failed', 'issues'] as const) expect(botSvg('impl', 2, st).isInteractive).toBeUndefined()
  expect(stageSvg('execute', 4, true).isInteractive).toBe(true)
  expect(stageSvg('execute', 4, false).isInteractive).toBeUndefined()
})

test('sprites swap their white and pale pixels on a light background; terminal props follow the theme text', () => {
  const src = stageSvg('spec', 4, false).source
  expect(src).toContain('prefers-color-scheme: light')
  expect(src).toContain('class="pW"')
  expect(stageFrame('spec', 0, true)[2]![1]!.color).toBe('text')
})
