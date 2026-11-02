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

// The mockup's keyframes; motion only under the root's class="on"
const CSS = `<style>g{transform-box:fill-box}.spark{opacity:0}
.on .la{animation:st .5s steps(1) infinite}.on .lb{animation:st .5s steps(1) infinite -.25s}.on .bd{animation:bob .5s steps(1) infinite -.125s}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.on .swing{transform-origin:50% 100%;animation:swing .5s steps(1) infinite}@keyframes swing{0%{transform:rotate(-40deg)}50%{transform:rotate(30deg)}}
.on .spark{animation:spark .5s steps(1) infinite}@keyframes spark{50%{opacity:1}}
.on .scan{animation:scan 1.6s steps(1) infinite}@keyframes scan{0%{transform:translateX(0)}25%{transform:translateX(-3px)}50%{transform:translateX(-6px)}75%{transform:translateX(-3px)}}
.on .b1{animation:blink 1.5s steps(1) infinite}.on .b2{animation:blink 1.5s steps(1) infinite .5s}.on .b3{animation:blink 1.5s steps(1) infinite 1s}
@keyframes blink{0%{opacity:1}33%{opacity:.15}}
.on .quill{transform-origin:0% 100%;animation:quill .5s steps(1) infinite}@keyframes quill{50%{transform:rotate(-15deg) translateX(-1px)}}
.on .w1{animation:show 2s steps(1) infinite}.on .w2{animation:show 2s steps(1) infinite .66s}.on .w3{animation:show 2s steps(1) infinite 1.33s}
@keyframes show{0%{opacity:0}30%{opacity:1}}
.on .pencil{animation:draw 1s steps(1) infinite}@keyframes draw{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,0)}75%{transform:translate(-1px,-1px)}}
.on .grow{transform-origin:50% 100%;animation:grow 2s steps(1) infinite}@keyframes grow{0%{transform:scaleY(.25)}33%{transform:scaleY(.6)}66%{transform:scaleY(1)}}
.on .wave{transform-origin:0% 50%;animation:wave .25s steps(1) infinite}@keyframes wave{50%{transform:skewY(15deg)}}
.on .c1{animation:blink .8s steps(1) infinite}.on .c2{animation:blink .8s steps(1) infinite .4s}
.on .hop{animation:hop .4s steps(1) infinite}@keyframes hop{50%{transform:translateY(-1px)}}.on .ant{animation:blink .8s steps(1) infinite}
@media (prefers-reduced-motion: reduce){.on *{animation:none!important}}</style>`

const svgDoc = (body: string, w: number, h: number, scale: number, on: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg"${on ? ' class="on"' : ''} viewBox="0 -1 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${CSS}${body}</svg>`

/** Standalone SVG of a stage's Clawd; moves only when on */
export const stageSvg = (stage: Stage, scale: number, on: boolean) =>
  ({ source: svgDoc(STAGE_PX[stage], 25, 15, scale, on), width: 25 * scale, height: 15 * scale, alt: `${stage} · ${STAGE_NAME[stage]}` })

const ROLE_PX: Record<BotKind, { color: string; tool: string[] }> = {
  impl: { color: '#378ADD', tool: ['..G', '.GG', 'G..'] },
  review: { color: '#E0A030', tool: ['.GG', 'GLG', '.GB'] },
  fix: { color: '#E5534B', tool: ['.W.', 'WWW', '.W.'] },
  agent: { color: '#1D9E75', tool: [] },
}
// Marks drawn where the tool sits (x 10, y 3)
const MARK: Partial<Record<BotStatus, string[]>> = {
  done: ['..g', 'g.g', '.g.'],
  failed: ['R.R', '.R.', 'R.R'],
  issues: ['.Y.', '.Y.', '...', '.Y.'],
}
const BOT_PX = ['....a.....', '....w.....', '..XXXXXX..', '.XXXXXXXX.', '.XKXXXXKX.', '.XXXXXXXX.', '..XXXXXX..']

/** Standalone SVG of a sub-agent bot "Bit"; hops only while running */
export const botSvg = (kind: BotKind, scale: number, status: BotStatus) => {
  const r = ROLE_PX[kind]
  const rows = status === 'waiting' ? BOT_PX.map((l, i) => (i === 4 ? '.XKKXXKKX.' : l)) : BOT_PX
  const mark = MARK[status]
  const body = `<g class="hop">${layer([rows[0]!], 0, 0, 'ant', { a: r.color })}${layer(rows.slice(1), 0, 1, '', { X: r.color })}${mark ? layer(mark, 10, mark.length > 3 ? 2 : 3) : layer(r.tool, 10, 3)}</g>${layer(['..w....w..'], 0, 8)}`
  return { source: svgDoc(body, 14, 10, scale, status === 'running'), width: 14 * scale, height: 10 * scale, alt: `${kind} ${status}` }
}
