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

export const STAGE_NAME: Record<Stage, string> = { brainstorm: '꿈꾸는 현자', spec: '필경사', plan: '대마법 건축가', worktree: '숲의 드루이드', execute: '망치 대장장이', review: '그림자 추적자', finish: '축제 음유시인' }

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

// ---------- desktop pixel sprites (from the mockup's layer/clawd/STAGES/ROLES/bot) ----------
const PX: Record<string, string> = { '#': '#D97757', K: '#1F1E1D', Y: '#F2C94C', y: '#B8901E', B: '#8B5A2B', G: '#A3A8AE', W: '#F5F3EE', w: '#B9B6AE', U: '#4A90D9', u: '#9CC3EE', P: '#9B6BD6', g: '#5FBF6F', T: '#D9B77E', R: '#E5534B', M: '#E056FD', L: '#9ED8F5' }

/** One rect per horizontal run of a colour; '.' is empty */
const layer = (rows: string[], x: number, y: number, cls = '', over: Record<string, string> = {}) => {
  let s = ''
  rows.forEach((r, j) => {
    const cs = [...r]
    for (let i = 0; i < cs.length; ) {
      const col = cs[i] === '.' ? undefined : (over[cs[i]!] ?? PX[cs[i]!])
      let n = 1
      while (col && i + n < cs.length && (over[cs[i + n]!] ?? PX[cs[i + n]!]) === col && cs[i + n] !== '.') n++
      if (col) s += `<rect x="${x + i}" y="${y + j}" width="${n}" height="1" fill="${col}"/>`
      i += n
    }
  })
  return cls ? `<g class="${cls}">${s}</g>` : s
}

const BODY_PX = ['..##########..', '..#K######K#..', '##############', '..##########..', '..##########..']
const LA = ['..#........#..', '..#........#..'], LB = ['....#....#....', '....#....#....']
const clawd = (hat: string, props: string) => `<g class="bd">${layer(BODY_PX, 4, 6)}${hat}</g>${layer(LA, 4, 11, 'la')}${layer(LB, 4, 11, 'lb')}${props}`

const STAGE_PX: Record<Stage, string> = {
  brainstorm: clawd('', layer(['W'], 18, 5, 'b1') + layer(['WW', 'WW'], 19, 2, 'b2') + layer(['WWW', 'WWW'], 21, -1, 'b3')),
  spec: clawd(layer(['...W', '..WW', '.WW.'], 13, 3, 'quill2'),
    layer(['WWWW', 'W..W', 'W..W', 'W..W', 'WWWW'], 0, 7) + layer(['ww'], 1, 8, 'w1') + layer(['ww'], 1, 9, 'w2') + layer(['ww'], 1, 10, 'w3')
    + layer(['...W', '..WW', '.WW.', 'B...'], 18, 4, 'quill')),
  plan: clawd(layer(['....PP....', '.PPPPPPPP.', 'PPPPPPPPPP'], 6, 3),
    layer(['UUUUU', 'UuUuU', 'UUUUU', 'UuUuU', 'UUUUU'], 18, 7) + layer(['.Y', '.Y', 'K.'], 20, 4, 'pencil')),
  worktree: clawd(layer(['....TTTTTT....', '....yyyyyy....', 'TTTTTTTTTTTTTT'], 4, 3),
    layer(['g.g', '.g.', '.g.', '.g.'], 19, 7, 'grow') + layer(['RRR', '.R.'], 19, 11)),
  execute: clawd(layer(['...YYYYYY...', '.YYYYYYYYYY.', 'YYYYYYYYYYYY'], 5, 3),
    layer(['GGG', '.B.', '.B.', '.B.', '.B.'], 18, 3, 'swing') + layer(['Y.Y', '.Y.', 'Y.Y'], 21, 9, 'spark')),
  review: clawd(layer(['...BTBTBT...', '..TBTBTBTB..', 'BBTBTBTBTBBB'], 5, 3),
    layer(['.GG.', 'GLLG', 'GLLG', '.GG.', '...B', '....B'], 18, 6, 'scan')),
  finish: clawd(layer(['..MM..', '..WW..', '.MMMM.', 'MMMMMM'], 8, 2),
    layer(['w', 'w', 'w', 'w', 'w', 'w', 'w', 'w'], 18, 2) + layer(['KWK', 'WKW', 'KWK'], 19, 2, 'wave')
    + layer(['M...Y', '.....', '..L..'], 0, 1, 'c1') + layer(['..Y..', '.....', 'L...M'], 0, 3, 'c2')),
}

// The mockup's keyframes, scoped under the root's class="tp" (an inlined svg leaks nothing); motion only under class="tp on"
const CSS = `<style>.tp g{transform-box:fill-box}.tp .spark{opacity:0}
.tp.on .la{animation:st .5s steps(1) infinite}.tp.on .lb{animation:st .5s steps(1) infinite -.25s}.tp.on .bd{animation:bob .5s steps(1) infinite -.125s}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.tp.on .swing{transform-origin:50% 100%;animation:swing .5s steps(1) infinite}@keyframes swing{0%{transform:rotate(-40deg)}50%{transform:rotate(30deg)}}
.tp.on .spark{animation:spark .5s steps(1) infinite}@keyframes spark{50%{opacity:1}}
.tp.on .scan{animation:scan 1.6s steps(1) infinite}@keyframes scan{0%{transform:translateX(0)}25%{transform:translateX(-3px)}50%{transform:translateX(-6px)}75%{transform:translateX(-3px)}}
.tp.on .b1{animation:blink 1.5s steps(1) infinite}.tp.on .b2{animation:blink 1.5s steps(1) infinite .5s}.tp.on .b3{animation:blink 1.5s steps(1) infinite 1s}
@keyframes blink{0%{opacity:1}33%{opacity:.15}}
.tp.on .quill{transform-origin:0% 100%;animation:quill .5s steps(1) infinite}@keyframes quill{50%{transform:rotate(-15deg) translateX(-1px)}}
.tp.on .w1{animation:show 2s steps(1) infinite}.tp.on .w2{animation:show 2s steps(1) infinite .66s}.tp.on .w3{animation:show 2s steps(1) infinite 1.33s}
@keyframes show{0%{opacity:0}30%{opacity:1}}
.tp.on .pencil{animation:draw 1s steps(1) infinite}@keyframes draw{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,0)}75%{transform:translate(-1px,-1px)}}
.tp.on .grow{transform-origin:50% 100%;animation:grow 2s steps(1) infinite}@keyframes grow{0%{transform:scaleY(.25)}33%{transform:scaleY(.6)}66%{transform:scaleY(1)}}
.tp.on .wave{transform-origin:0% 50%;animation:wave .25s steps(1) infinite}@keyframes wave{50%{transform:skewY(15deg)}}
.tp.on .c1{animation:blink .8s steps(1) infinite}.tp.on .c2{animation:blink .8s steps(1) infinite .4s}
.tp.on .hop{animation:hop .4s steps(1) infinite}@keyframes hop{50%{transform:translateY(-1px)}}
.tp.on .tool{transform-origin:0% 100%;animation:wig .6s steps(1) infinite}@keyframes wig{50%{transform:rotate(-20deg)}}
@media (prefers-reduced-motion: reduce){.tp.on *{animation:none!important}}</style>`

const svgDoc = (body: string, w: number, h: number, scale: number, on: boolean) =>
  `<svg class="tp${on ? ' on' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${CSS}${body}</svg>`

/** Standalone SVG of a stage's Clawd; moves only when on */
export const stageSvg = (stage: Stage, scale: number, on: boolean) =>
  ({ source: svgDoc(STAGE_PX[stage], 25, 15, scale, on), width: 25 * scale, height: 15 * scale, alt: `${stage} · ${STAGE_NAME[stage]}`, ...(on ? { isInteractive: true as const } : {}) })

const ROLE_PX: Record<BotKind, { color: string; tool: string[] }> = {
  impl: { color: '#378ADD', tool: ['..G', '.GG', 'G..'] },
  review: { color: '#E0A030', tool: ['.GG', 'GLG', '.GB'] },
  fix: { color: '#E5534B', tool: ['.W.', 'WWW', '.W.'] },
  agent: { color: '#1D9E75', tool: [] },
}
// Marks drawn where the tool sits (x 15, y 2)
const MARK: Partial<Record<BotStatus, string[]>> = {
  done: ['..g', 'g.g', '.g.'],
  failed: ['R.R', '.R.', 'R.R'],
  issues: ['.Y.', '.Y.', '...', '.Y.'],
}
// From the desktop-pane mockup's A: a little Clawd, its hat ('H') in the role's colour; eyes 3x2 at (3,2) and (8,2)
const MINI = ['....HHHHHH....', '...HHHHHHHH...', '..##########..', '..##########..', '##############', '..##########..', '..##########..']
const MINI_LEGS = ['..#.#....#.#..', '..#.#....#.#..']
const EYES: Record<BotStatus, string[]> = { running: ['.K.', '.K.'], waiting: ['...', 'KKK'], done: ['.K.', 'K.K'], failed: ['K.K', '.K.'], issues: ['KKK', 'K.K'] }

/** Standalone SVG of a sub-agent's little Clawd; hops and wiggles its tool only while running */
export const botSvg = (kind: BotKind, scale: number, status: BotStatus) => {
  const r = ROLE_PX[kind]
  const on = status === 'running'
  const mark = MARK[status]
  const face = layer(EYES[status], 3, 2) + layer(EYES[status], 8, 2)
  const side = mark ? layer(mark, 15, mark.length > 3 ? 1 : 2) : layer(r.tool, 15, 2, 'tool')
  const body = `<g class="hop">${layer(MINI, 0, 0, '', { H: r.color })}${face}${side}</g>${layer(MINI_LEGS, 0, MINI.length)}`
  return { source: svgDoc(body, 18, 10, scale, on), width: 18 * scale, height: 10 * scale, alt: `${kind} ${status}`, ...(on ? { isInteractive: true as const } : {}) }
}

const BAR = { done: '#5fbf8f', active: '#f2c94c', todo: '#3a3833', hi: '#fff3c4' }
const r2 = (n: number) => Math.round(n * 100) / 100

/** The plan bar for surfaces that draw Svg: done, active and todo by share, stretched to its box; a bright band sweeps the active part while it works */
export const barSvg = (done: number, active: number, total: number, on: boolean) => {
  const t = Math.max(1, total)
  const d = r2((done / t) * 100), a = r2((active / t) * 100), rest = r2(100 - d - a)
  const hiW = Math.min(4, a)
  // a part no wider than the band has nowhere to sweep: drawn still, so no frame
  const moving = on && a > hiW
  const rect = (x: number, w: number, fill: string, cls = '') => (w > 0 ? `<rect${cls ? ` class="${cls}"` : ''} x="${x}" y="0" width="${w}" height="6" fill="${fill}"/>` : '')
  const css = moving
    ? `<style>.tp.on .sw{animation:sw 1s steps(10) infinite}@keyframes sw{to{transform:translateX(${r2(a - hiW)}px)}}@media (prefers-reduced-motion: reduce){.tp.on *{animation:none!important}}</style>`
    : ''
  const body = rect(0, d, BAR.done) + rect(d, a, BAR.active) + rect(r2(d + a), rest, BAR.todo) + (moving ? rect(d, hiW, BAR.hi, 'sw') : '')
  const source = `<svg class="tp${moving ? ' on' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 6" preserveAspectRatio="none" width="100%" height="10" shape-rendering="crispEdges">${css}${body}</svg>`
  return { source, height: 10, alt: `${done}/${total}`, ...(moving ? { isInteractive: true as const } : {}) }
}
