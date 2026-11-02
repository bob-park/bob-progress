import type { AgentRun, Stage } from '../types'

export type Seg = { text: string; color: string }
export type BotKind = 'impl' | 'review' | 'fix' | 'agent'
export type BotStatus = 'running' | 'waiting' | 'done' | 'failed' | 'issues'

/** SDD names its fix loop in the label; the role says the rest */
export const phaseOf = (r: AgentRun) => (/^fix\b/i.test(r.label) ? 'fix' : /^re-review/i.test(r.label) ? 're-review' : (r.role ?? ''))

export const botKind = (r: AgentRun): BotKind => {
  const p = phaseOf(r)
  return p === 'impl' || p === 'fix' ? p : p === 'review' || p === 're-review' ? 'review' : 'agent'
}
export const botStatus = (r: AgentRun): BotStatus => (r.status === 'failed' ? 'failed' : r.verdict === 'issues' ? 'issues' : r.status)

export const STAGE_NAME: Record<Stage, string> = { brainstorm: '생각쟁이', spec: '서기', plan: '설계사', worktree: '정원사', execute: '건설공', review: '탐정', finish: '축하꾼' }

/** Cells per character line: hat/body 9 + prop 3 */
export const STAGE_W = 12
/** Cells per bot glyph */
export const BOT_W = 7

const C = { clay: '#D97757', green: '#5fbf8f', yellow: '#f2c94c', mag: '#e056fd', blue: '#61afef', red: '#e5534b', fg: '#e8e6df', cyan: '#56b6c2', brown: '#c8a26b' }
type Look = { hat: [string, string]; props: string[][]; pc: string }
// Frames from the mockup's TSTAGE
const LOOK: Record<Stage, Look> = {
  brainstorm: { hat: ['         ', C.fg], props: [['   ', '   ', '   ', '   '], ['   ', '   ', '°  ', '   '], ['   ', ' o ', '°  ', '   '], [' O ', ' o ', '°  ', '   ']], pc: C.fg },
  spec: { hat: ['     ╱   ', C.fg], props: [['   ', '   ', '✎  ', '   '], ['   ', '   ', '─✎ ', '   '], ['   ', '   ', '──✎', '   '], ['   ', '   ', '───', '   ']], pc: C.fg },
  plan: { hat: ['  ▄▀▀▀▄  ', C.mag], props: [['   ', '┌┬┐', '├✎┤', '└┴┘'], ['   ', '┌✎┐', '├┼┤', '└┴┘'], ['   ', '┌┬┐', '├┼✎', '└┴┘'], ['   ', '┌┬┐', '├┼┤', '└✎┘']], pc: C.blue },
  worktree: { hat: [' ▁▄▄▄▄▄▁ ', C.brown], props: [['   ', '   ', '   ', ' ▄ '], ['   ', '   ', ' ı ', ' ▄ '], ['   ', ' ╷ ', ' │ ', ' ▄ '], ['   ', '╲╿╱', ' │ ', ' ▄ ']], pc: C.green },
  execute: { hat: ['  ▄███▄  ', C.yellow], props: [['╺┳╸', ' ┃ ', '   ', '   '], ['   ', '━┫ ', '  ✦', '   ']], pc: C.yellow },
  review: { hat: [' ▗▛▀▀▀▜▖ ', C.brown], props: [['   ', '◎  ', ' ╲ ', '   '], ['   ', ' ◎ ', '  ╲', '   '], ['   ', '  ◎', '  ╲', '   '], ['   ', ' ◎ ', '  ╲', '   ']], pc: C.cyan },
  finish: { hat: ['    ▲    ', C.mag], props: [['|▶ ', '|  ', '|  ', '|  '], ['|▷ ', '| *', '|  ', '|  ']], pc: C.red },
}
const BODY = [' ▐▛███▜▌ ', '▝▜█████▛▘']
const FEET = ['  ▘▘ ▝▝  ', '  ▝▝ ▘▘  ']

/** 4 lines of [body, prop] for a stage character; still unless on */
export const stageFrame = (stage: Stage, f: number, on: boolean): Seg[][] => {
  const s = LOOK[stage], k = on ? f : 0
  const p = s.props[Math.floor(k / 3) % s.props.length]!
  const body: Seg[] = [{ text: s.hat[0], color: s.hat[1] }, ...[BODY[0]!, BODY[1]!, FEET[Math.floor(k / 5) % 2]!].map(text => ({ text, color: C.clay }))]
  return body.map((b, i) => [b, { text: p[i]!, color: s.pc }])
}

const BOT: Record<BotKind, { run: string[]; c: string }> = {
  impl: { run: ['[•_•]⚙', '[•_•]✲'], c: '#378ADD' },
  review: { run: ['[•_•]⌕', '[•_•] ⌕'], c: '#E0A030' },
  fix: { run: ['[•_•]✚', '[•‸•]✚'], c: '#E5534B' },
  agent: { run: ['[•_•]»', '[•_•] »'], c: '#1D9E75' },
}
const pad = (t: string) => t + ' '.repeat(BOT_W - [...t].length)

export const botFrame = (kind: BotKind, f: number, status: BotStatus): Seg => {
  const b = BOT[kind]
  const [t, c] = status === 'done' ? ['[^_^]✓', 'green'] : status === 'failed' ? ['[x_x]✗', 'red'] : status === 'issues' ? ['[o_o]⚠', '#E0A030'] : status === 'waiting' ? ['[-_-]z', b.c] : [b.run[Math.floor(f / 3) % 2]!, b.c]
  return { text: pad(t), color: c }
}
