import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { Ev, ToolInput } from './ev'
import { ledgerPath } from './plan'
import { derive, editedOf, INIT, step } from './state'
import type { Effect, S } from './state'
import { skillName } from './superpowers'
import { VERSION } from './version'
import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, spPanel, SPINNER, tasksPanel } from './view'

// the one atom: every hook folds an event into it; the 0.9 keys are never read
const state = atom({ plugin: 'bob-progress', key: 'state' } as const, INIT)

const PANE = 'bob-progress'
const PANE_COLUMNS = 48

// while anything works the pane redraws on a clock so the spinner and shimmer move
const frame = () => Math.floor(Date.now() / FRAME_MS)
let ticker: Timer | undefined
const animate = ($: EngineInterface, s: S) => {
  if (derive(s, 0).busy) ticker ??= $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  else ticker = void ticker?.cancel()
}

/** Folds the event into the atom; resolves the effects that step returned */
type Untimed<E> = E extends Ev ? Omit<E, 'at'> : never
const emit = async ($: EngineInterface, ev: Untimed<Ev>): Promise<Effect[]> => {
  const full = { ...ev, at: await $.clock.now() } as Ev
  let effects: Effect[] = []
  let after: S = INIT
  await update($, state, s => {
    const r = step({ ...INIT, ...s }, full)
    effects = r.effects
    after = r.s
    return r.s
  })
  animate($, after)
  return effects
}

type Usage = Awaited<ReturnType<EngineInterface['session']['usage']>>
const usageOf = (u: Pick<Usage, 'context' | 'cost' | 'rateLimits'>) =>
  ({
    t: 'usage',
    pct: u.context.percent ?? null,
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    costUsd: u.cost?.usd ?? null,
    limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
  }) as const

// ponytail: one counter for all agents, a main-loop skill loaded while a subagent's loads is skipped too; key by agent if that shows up
let subagentSkills = 0

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Bob Progress', columns: PANE_COLUMNS, rows: 8 })

// re-read the active plan and its ledger: SDD's scripts append from Bash; a failed plan read keeps what the pane shows
const readPlan = async ($: EngineInterface) => {
  const path = (await read($, state))?.plan?.path
  if (!path) return
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string') return
  await emit($, { t: 'file', path, text })
  const at = ledgerPath(path)
  // a deleted ledger reads as empty, so its stale dispatches clear
  if (at) await emit($, { t: 'file', path: at, text: (await $.fs.read(at).catch(() => null)) ?? '' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bob-progress', description: 'Open or close the Bob Progress pane', argumentHint: '[close]' })
    // a host without usage (headless, SDK) just starts without it
    const u = await $.session.usage().catch(() => null)
    if (u) await emit($, usageOf(u))
    void openPane($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'bob-progress' }, async ($, e) => {
    if (e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Bob Progress closed.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Bob Progress opened.' : `Bob Progress is not shown yet: ${opened.reason}` }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode) await emit($, { t: 'mode', mode: e.permission_mode })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await emit($, { t: 'turn.start', agentId: e.agentId })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const { agentId } = e
    // an agent waiting on its own background work ends its turn but isn't done
    const waiting = !!agentId && (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.status === 'waiting'
    await emit($, { t: 'turn.end', agentId, answer: e.answer, failed: e.reason === 'error' || e.reason === 'aborted', waiting })
    return done
  })

  on('turn.step', async function* ($, e, next) {
    await emit($, { t: 'step', agentId: e.agentId, model: e.model, ...(e.effort !== undefined ? { effort: String(e.effort) } : {}) })
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId, model = '' } = spawned as { agentId?: string; model?: string }
    if (agentId) await emit($, { t: 'agent.spawn', agentId, description: e.description ?? '', subagentType: e.subagentType ?? '', model })
    return spawned
  })

  on('skill.prompt', async ($, e, next) => {
    // a skill a subagent loads (`tool.call` knows the agent, this event doesn't) never moves the stage
    await emit($, { t: 'skill', name: skillName(e.skill), fromSubagent: subagentSkills > 0 })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await emit($, usageOf(e))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') await emit($, { t: 'compact' })
    return done
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const input = e as ToolInput
    const call = { agentId: e.agentId, id, tool: e.tool, input }
    await emit($, { t: 'tool.start', ...call })
    let ran: Awaited<ReturnType<typeof next>>
    const sub = e.tool === 'Skill' && !!e.agentId
    if (sub) subagentSkills++
    try {
      ran = await next(e)
    } catch (err) {
      await emit($, { t: 'tool.end', ...call, ok: false, edited: [] })
      throw err
    } finally {
      if (sub) subagentSkills--
    }
    const { file_path = '', notebook_path = '' } = e as { file_path?: string; notebook_path?: string }
    const edited = e.tool === 'Edit' || e.tool === 'Write' ? [file_path] : e.tool === 'NotebookEdit' ? [notebook_path] : e.tool === 'Bash' ? editedOf(e.command, ran.result) : []
    // next(e) ran before e.tool was narrowed, so result isn't typed per tool
    const createdTaskId = e.tool === 'TaskCreate' ? (ran.result as BuiltinToolResults['TaskCreate'] | undefined)?.task?.id : undefined
    const planFile = e.tool === 'ExitPlanMode' ? (ran.result as BuiltinToolResults['ExitPlanMode'] | undefined)?.filePath : undefined
    const ok = ran.deny === undefined && !ran.isError
    const effects = await emit($, { t: 'tool.end', ...call, ok, edited, ...(createdTaskId ? { createdTaskId } : {}), ...(planFile ? { planFile } : {}) })
    if (!e.agentId) await readPlan($)
    if (ran.deny !== undefined || ran.isError) return ran
    const context = [
      ...effects.filter(x => x.kind === 'warn' && x.toolId === id).map(x => x.text),
      ...(planFile ? [`Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${planFile} as you finish it.`] : []),
    ]
    return context.length ? { ...ran, context: [...(ran.context ?? []), ...context] } : ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [s, now] = await Promise.all([read($, state), $.clock.now()])
    const view = derive({ ...INIT, ...s }, now)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const f = frame()
    const v = { W: Math.max(30, e.props.bodyColumns), f, spin: SPINNER[f % SPINNER.length]!, busy: view.busy, now, px: e.surface !== 'terminal' }
    return (
      <Box flexDirection="column" gap="sm">
        {mainPanel(ui, view.main, v, VERSION)}
        {view.sp.stages.length > 0 ? spPanel(ui, view.sp, view.spTasks, view.runs, v) : null}
        {view.shown.length > 0 ? tasksPanel(ui, view.shown, view.main.doneAt, v) : null}
        {view.runs.some(r => !r.role) ? agentsPanel(ui, view.runs, v) : null}
        {view.skills.length > 0 ? skillsPanel(ui, view.skills, v) : null}
        {view.activity.length > 0 ? activityPanel(ui, view.activity, v) : null}
      </Box>
    )
  })
}
