import type { Ev } from '../hooks/ev'
import { logOf, parsePlan } from '../hooks/plan'
import type { Effect, S } from '../hooks/state'
import { INIT, isEdit, isSpPlan, isWorkflowFile, step, tied } from '../hooks/state'
import { ORDER } from '../hooks/superpowers'

export type Violation = { kind: 'I1' | 'I2' | 'I3' | 'I4'; at: number }
type Fold = (s: S, ev: Ev) => { s: S; effects: Effect[] }

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const LEDGER = /\/\.superpowers\/sdd\/([^/]+)\/progress\.md$/
const doneOf = (p: S['plan']) => p.tasks.filter(t => t.status === 'completed').length

/** Folds a session through the reducer and checks the spec's I1–I4; `fold` is swappable so the checks themselves can be tested */
export const check = (evs: Ev[], fold: Fold = step) => {
  const violations: Violation[] = []
  let s = INIT
  let linked = 0
  let edits = 0
  let warned = false
  let warns = 0
  // per plan basename: the completed count last seen, the plan state last held, the ledger's completions
  const done: Record<string, number> = {}
  const last: Record<string, S['plan']> = {}
  const logged: Record<string, Set<string>> = {}
  for (const [i, ev] of evs.entries()) {
    const prev = s
    let effects: Effect[]
    try {
      ;({ s, effects } = fold(s, ev))
    } catch {
      violations.push({ kind: 'I4', at: i })
      return { violations, linked, edits, warns }
    }
    const p = s.plan
    const ledger = ev.t === 'file' ? LEDGER.exec(ev.path) : null
    if (ev.t === 'file' && ledger) logged[`${ledger[1]}.md`] = new Set([...(logged[`${ledger[1]}.md`] ?? []), ...logOf(ev.text, 'complete')])

    // I1: an execute-stage main-loop edit is tied by rules 1–3, or its gap got the warning
    if (tied(p)) warned = false
    if (effects.some(e => e.kind === 'warn')) (warned = true), warns++
    if (isEdit(ev) && s.sp.current === 'execute' && isSpPlan(p) && p.tasks.some(t => t.status !== 'completed') && ev.edited.some(f => !isWorkflowFile(f))) {
      edits++
      if (tied(p)) linked++
      else if (!warned) violations.push({ kind: 'I1', at: i })
    }

    // I2: a loaded plan's completed count never drops; the stage never moves back within a cycle
    if (p.path && p.text) {
      const k = base(p.path)
      if (doneOf(p) < (done[k] ?? 0)) violations.push({ kind: 'I2', at: i })
      done[k] = doneOf(p)
      last[k] = p
    }
    const newCycle = prev.sp.stages.includes('finish') && !s.sp.stages.includes('finish')
    if (prev.sp.current && s.sp.current && ORDER.indexOf(s.sp.current) < ORDER.indexOf(prev.sp.current) && !newCycle) violations.push({ kind: 'I2', at: i })
  }

  // I3: each superpowers plan ends with as many completed tasks as have evidence: a ledger completion or every step ticked
  for (const [k, p] of Object.entries(last)) {
    if (!isSpPlan(p)) continue
    const ticked = parsePlan(p.text)
    const proven = ticked.filter(t => t.status === 'completed' || logged[k]?.has(t.n ?? ''))
    if (doneOf(p) !== proven.length) violations.push({ kind: 'I3', at: evs.length - 1 })
  }
  return { violations, linked, edits, warns }
}
