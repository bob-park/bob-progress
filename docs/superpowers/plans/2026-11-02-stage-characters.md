# 단계별 캐릭터와 에이전트 캐릭터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⚡ SUPERPOWERS의 현재 단계를 캐릭터가 들어간 카드로 그리고, 에이전트 줄의 상태 아이콘을 로봇 "비트"로 바꾼다. 데스크톱 앱과 터미널 둘 다에서, 일하는 동안만 움직인다.

**Architecture:** 새 파일 `hooks/characters.ts`에 순수 함수 네 개를 둔다. 터미널 프레임 함수 두 개, SVG 문자열 함수 두 개다. `view.tsx`는 `Frame.px`(Svg가 있는 화면인지)를 보고 둘 중 하나를 부른다. 상태와 reducer는 바꾸지 않는다. 터미널은 기존 100ms ticker의 `v.f`로 프레임을 고르고, 데스크톱은 SVG 안의 CSS keyframes가 움직인다.

**Tech Stack:** TypeScript/TSX Claude Code mod (`claude-code` 렌더 API: `Box`/`Text`/`Svg`), 테스트는 `claude-code/testing`, `claude plugin test .`

**Spec:** `docs/superpowers/specs/2026-11-02-stage-characters-design.md`. 모양의 정답은 `docs/superpowers/specs/2026-11-02-stage-characters-mockup.html`이다(`STAGES`, `ROLES`, `BOT`, `TSTAGE`, `BODY_T`, `FEET`, `BOTT`, CSS keyframes).

## Global Constraints

- 새 의존성 없음. 상태(`hooks/state.ts`)와 `types/index.d.ts`의 상태 타입은 바꾸지 않는다.
- 터미널 줄은 패널 본문 폭(`v.W`, 기본 `bodyColumns` 46)을 넘지 않는다. 테두리를 깨지 않는다.
- 단계 캐릭터는 `v.busy`일 때만 움직이고, 비트는 그 에이전트가 `running`일 때만 움직인다. 멈추면 항상 첫 프레임이다.
- 데스크톱 SVG `source`는 같은 입력이면 같은 문자열이다. 프레임 번호, 시간, 경과 시간은 SVG에 넣지 않는다.
- 데스크톱 SVG에는 `@media (prefers-reduced-motion: reduce)`로 모든 애니메이션을 끄는 규칙이 들어간다.
- `Svg`의 `alt`는 필수다.
- 버전은 `1.0.0`에서 `1.1.0`으로 올린다(`hooks/version.ts`, `.claude-plugin/plugin.json`).
- 테스트는 상태를 심지 않고(memory: test-state-seeding), export한 순수 함수와 기존 방식의 이벤트 구동 mount로만 검증한다.

## Review Focus

- 좁은 패널(`bodyColumns` 30 안팎): 캐릭터 카드가 줄을 넘기지 않고 지금 줄 모양으로 돌아가야 한다. Task 3의 `narrow pane falls back to the plain stage row` 테스트가 맡는다.
- idle(턴 종료)인데 에이전트 하나가 계속 running인 경우: busy는 true다(`derive().busy`가 에이전트를 셈). 단계 캐릭터가 움직이는 것이 기대 동작이다. Task 3 테스트가 맡는다.
- 실패한 에이전트와 `issues` 리뷰가 웃는 얼굴로 나오면 안 된다. 같은 에이전트가 failed면서 issues이면 failed가 이긴다. Task 1의 `botStatus` 테스트가 맡는다.
- 데스크톱에서 100ms redraw마다 애니메이션이 처음부터 다시 시작될 수 있다. 같은 입력에서 SVG 문자열이 같은지는 Task 2 테스트가 보고, 실제 동작은 Task 4에서 데스크톱 앱으로 직접 확인한다.
- AGENTS 섹션의 일반 에이전트(role 없음)도 비트로 나온다. 초록, kind `agent`다. Task 3 테스트가 맡는다.

---

### Task 1: 터미널 캐릭터 프레임

**Files:**
- Create: `hooks/characters.ts`
- Test: `hooks/characters.test.ts`

**Interfaces:**
- Consumes: `Stage`, `AgentRun`(`types/index.d.ts`), `phaseOf(r)`(`hooks/view.tsx`; 순환 import를 피하려면 `characters.ts`로 옮기고 `view.tsx`가 다시 export한다)
- Produces:
  - `type Seg = { text: string; color: string }`
  - `type BotKind = 'impl' | 'review' | 'fix' | 'agent'`
  - `type BotStatus = 'running' | 'waiting' | 'done' | 'failed' | 'issues'`
  - `STAGE_NAME: Record<Stage, string>`: 목업 `STAGES[s].ko`(생각쟁이, 서기, 설계사, 정원사, 건설공, 탐정, 축하꾼)
  - `botKind(r: AgentRun): BotKind`: `phaseOf(r)`가 `impl`이면 impl, `review`/`re-review`면 review, `fix`면 fix, `''`이면 agent
  - `botStatus(r: AgentRun): BotStatus`: failed가 먼저, 다음 `verdict === 'issues'`, 그 밖에는 `r.status`
  - `STAGE_W = 12`: 캐릭터 한 줄의 칸 수(모자/몸 9 + 도구 3)
  - `BOT_W = 7`: 비트 글리프의 칸 수
  - `stageFrame(stage: Stage, f: number, on: boolean): Seg[][]`: 4줄이고, 각 줄은 `[몸 Seg, 도구 Seg]`이다
  - `botFrame(kind: BotKind, f: number, status: BotStatus): Seg`

- [ ] **Step 1: 실패하는 테스트 작성** (`hooks/characters.test.ts`)

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: `characters.test.ts`가 FAIL(모듈 없음). 기존 104개는 PASS.

- [ ] **Step 3: `hooks/characters.ts` 구현**

- 데이터는 목업의 `TSTAGE`, `BODY_T`, `FEET`, `BOTT`를 그대로 옮긴다. 목업에서 `execute`와 `finish`의 props가 2프레임인 것도 그대로다.
- 도구 프레임은 `Math.floor(f / 3) % props.length`, 발 프레임은 `Math.floor(f / 5) % 2`로 고른다. `on=false`면 `f = 0`으로 본다.
- 색은 hex 문자열로 둔다. 몸은 `#D97757`이고, 모자와 도구는 목업 `TC`의 값을 쓴다.
- 비트 running 프레임은 `Math.floor(f / 3) % 2`로 고르고, 끝을 공백으로 채워 `BOT_W`칸에 맞춘다.
- 비트 색: impl `#378ADD`, review `#E0A030`, fix `#E5534B`, agent `#1D9E75`. done은 `green`, failed는 `red`, issues는 `#E0A030`, waiting은 role 색으로 둔다.

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test .`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/characters.ts hooks/characters.test.ts hooks/view.tsx
git commit -m "feat: 단계 캐릭터와 비트의 터미널 프레임"
```

### Task 2: 데스크톱 SVG 스프라이트

**Files:**
- Modify: `hooks/characters.ts`
- Test: `hooks/characters.test.ts`

**Interfaces:**
- Consumes: Task 1의 `BotKind`, `BotStatus`, `STAGE_NAME`
- Produces:
  - `stageSvg(stage: Stage, scale: number, on: boolean): { source: string; width: number; height: number; alt: string }`: 크기는 `25*scale × 15*scale`(viewBox `0 -1 25 15`), alt는 `` `${stage} · ${STAGE_NAME[stage]}` ``
  - `botSvg(kind: BotKind, scale: number, status: BotStatus): { source: string; width: number; height: number; alt: string }`: 크기는 `14*scale × 10*scale`(viewBox `0 -1 14 10`), alt는 `` `${kind} ${status}` ``

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
test('stageSvg: same input, same markup; animates only when on; honours reduced motion', () => {
  for (const s of ORDER) {
    const a = stageSvg(s, 4, true)
    expect(a).toEqual(stageSvg(s, 4, true))
    expect(a.source.startsWith('<svg')).toBe(true)
    expect(a.source.length).toBeLessThan(131072)
    expect(a.source).toContain('prefers-reduced-motion')
    expect(a.source).toContain('class="on')
    expect(stageSvg(s, 4, false).source).not.toContain('class="on')
    expect([a.width, a.height]).toEqual([100, 60])
  }
})

test('botSvg: moves only while running; status marks for done, failed, issues', () => {
  expect(botSvg('impl', 2, 'running').source).toContain('class="on')
  for (const st of ['waiting', 'done', 'failed', 'issues'] as const) expect(botSvg('impl', 2, st).source).not.toContain('class="on')
  expect(botSvg('impl', 2, 'done').source).not.toEqual(botSvg('impl', 2, 'failed').source)
  expect(botSvg('impl', 2, 'issues').source).not.toEqual(botSvg('impl', 2, 'done').source)
  expect([botSvg('fix', 2, 'done').width, botSvg('fix', 2, 'done').height]).toEqual([28, 20])
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .` / Expected: 새 두 테스트 FAIL

- [ ] **Step 3: 구현**

- 목업의 `layer`/`clawd`/`STAGES[*].svg`/`BOT`/`ROLES`와 CSS 블록을 옮긴다. `<style>`은 SVG 안에 둔다.
- 루트 `<svg>`에는 `xmlns="http://www.w3.org/2000/svg"`와 `shape-rendering="crispEdges"`를 붙이고, 움직일 때만 `class="on"`을 붙인다.
- 비트의 상태 표시는 다음과 같다.
  - waiting: 눈 자리(`K`)를 가로 한 줄로 바꿔 감은 눈으로 그린다.
  - done: 목업처럼 초록 체크 픽셀을 그린다.
  - failed: 빨간 X 픽셀을 그린다.
  - issues: 노란 `!` 픽셀을 그린다.
- rect를 픽셀마다 하나씩 그리지 말고, 가로로 같은 색이 이어지면 rect 하나로 합친다. 문자열 길이를 줄이려는 것이다.

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test .` / Expected: 전부 PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 단계 캐릭터와 비트의 SVG 스프라이트"`

### Task 3: 패널에 캐릭터 넣기

**Files:**
- Modify: `hooks/view.tsx`(`Frame`, `agentRow`, `agentsPanel`, `spPanel`), `hooks/register.tsx:175`(`v`에 `px` 추가)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: Task 1, 2의 export 전부
- Produces:
  - `Frame`에 `px: boolean` 필드를 추가한다. `register.tsx`에서 `'Svg' in ui`로 채운다.
  - `STAGE_CARD_MIN_W = 40`(내 판단): `v.W`가 이보다 작으면 터미널 카드를 그리지 않고 지금 줄 모양으로 그린다.

**동작:**
- **에이전트 줄(`agentRow`, SUPERPOWERS와 AGENTS 둘 다)**
  - 맨 앞 상태 아이콘(`⠹`/`⏸`/`✓`/`✗`/`⚠`)을 비트로 바꾼다.
  - 터미널: 바깥 `Text`(지금 색 규칙 그대로)를 두고, 그 안에 `<Text color={bot.color}>{bot.text}</Text>`와 나머지 문자열을 넣는다. 나머지 문자열은 `lineUp`으로 만들되, 줄 전체 폭이 지금과 같도록 `W`를 `BOT_W - 1`만큼 줄여서 넘긴다. `lineUp`의 아이콘 자리는 빈 문자열로 둔다. 비트 다음에 공백 한 칸이 오게 한다.
  - 데스크톱: `<Box flexDirection="row" gap={1}><Svg {...botSvg(kind, 2, status)} /><Text …>{줄 글자}</Text></Box>`
  - `agentRow`의 `icon` 매개변수는 없앤다. `⚠`는 이제 `botStatus`가 정한다.
- **끝난 단계·오지 않은 단계 줄**
  - 터미널: 지금 그대로 둔다.
  - 데스크톱: 끝난 단계는 `stageSvg(stage, 1, false)` + 지금 줄 글자, 오지 않은 단계는 지금 줄 그대로 둔다.
  - 그 단계의 에이전트(`rolesOf`)는 지금처럼 아래에 붙는다.
- **현재 단계(`state === 'current'`)**
  - 터미널이고 `v.W >= STAGE_CARD_MIN_W`일 때: 4줄을 그린다. 각 줄은 `stageFrame(stage, v.f, v.busy)`의 i번째 줄 + 공백 2칸 + 오른쪽 내용 i번째 줄이다. 오른쪽 내용의 폭은 `v.W - 4 - STAGE_W - 2`다.
    - 1줄: `{mark} {stage}`와 시간(`lineUp`과 같은 정렬)
    - 2줄: execute이고 plan이 있으면 `planBar`. 막대 폭은 오른쪽 폭에 맞춘다. 그 밖에는 `STAGE_NAME[stage]`(dim)
    - 3줄: execute이고 plan이 있으면 `spNow`의 줄. 지금은 `nested('now', …)`로 따로 그리지만 카드 안으로 옮긴다.
    - 4줄: 비움
  - 데스크톱: `<Box flexDirection="row" gap={1}>`. 왼쪽은 `<Svg {...stageSvg(stage, 4, v.busy)} />`, 오른쪽은 위 1~3줄 내용을 `Box column`으로 쌓는다. 폭 제한은 터미널과 같다.
  - 좁은 터미널이면 지금 코드 그대로 그린다(지금 줄 + `nested('now')`).

- [ ] **Step 1: 실패하는 테스트로 바꾸고 추가**

  아이콘을 기대하던 기존 단언을 비트 글리프로 바꾼다.
  - `register.test.ts:226,235,236,251,298,299,401,720` 등이다. `grep -n "\^⏸\|\^✓ [0-9]\|\^✗ [0-9]\|⚠" hooks/register.test.ts`로 찾는다. 에이전트 줄이 아닌 단언(`✓ completed`, `✓ brainstorm`, ACTIVITY의 `✗ Bash`)은 건드리지 않는다.
  - 예: `/^✓ 1: Explore auth -+ Haiku 5\.5 01:23$/`는 `/^\[\^_\^\]✓ +1: Explore auth -+ Haiku 5\.5 01:23$/`로, `/^⚠ review #3 +issues 00:00$/`는 `/^\[o_o\]⚠ +review #3 +issues 00:00$/`로 바꾼다.
  - execute 카드 때문에 `✓ execute █+ 6/6`(line 718)처럼 위치가 바뀌는 단언은, 카드 오른쪽 열에서 같은 글자를 찾도록 바꾼다.

  새 테스트(기존 테스트의 이벤트 구동 방식을 따른다. line 474 `timeline nests the plan bar…`가 execute까지 가는 예다):

```ts
test('the current stage draws its character card in the terminal', async ($, on) => {
  // …execute까지 진행(line 474 테스트와 같은 준비)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /▄███▄/ })).toBeDefined()        // 건설공 안전모
  expect(await ui.find({ text: /▐▛███▜▌/ })).toBeDefined()
  for (const t of await ui.findAll({ type: 'Text' })) expect([...t.text].length).toBeLessThanOrEqual(46)
})

test('desktop draws stage and agent sprites as Svg with alt text', async ($, on) => {
  // …execute까지 진행, impl 에이전트 하나 running
  const ui = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map(s => s.props.alt)).toContain('execute · 건설공')
  expect(svgs.map(s => s.props.alt)).toContain('impl running')
  expect(svgs.some(s => /^brainstorm · /.test(String(s.props.alt)))).toBe(true) // 끝난 단계는 1배 정지 캐릭터
})

test('narrow pane falls back to the plain stage row', async ($, on) => {
  // …execute까지 진행, bodyColumns: 34
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 34 }, surface: 'terminal' } as never)
  expect(await ui.find({ text: /▐▛███▜▌/ })).toBeUndefined()
  expect(await ui.find({ text: /execute/ })).toBeDefined()
})

test('a plain agent under AGENTS draws as a green bit', async ($, on) => {
  // line 195 테스트 준비 그대로
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect((await ui.find({ text: /^\[•_•\] ?» *$/ }))?.props.color).toBe('#1D9E75')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .` / Expected: 바꾼 단언과 새 테스트가 FAIL

- [ ] **Step 3: 위 "동작"대로 `view.tsx`와 `register.tsx` 구현**

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test .` / Expected: 전부 PASS. `bun test replay`도 PASS(reducer는 안 바뀌었으니 그대로여야 한다).

- [ ] **Step 5: Commit** — `git commit -m "feat: 현재 단계 캐릭터 카드와 에이전트 비트"`

### Task 4: 실제 화면 확인, README, 버전

**Files:**
- Modify: `hooks/version.ts`, `.claude-plugin/plugin.json`(`1.1.0`), `README.md`(SUPERPOWERS 항목), `docs/images/task-progress.{gif,png}`
- Test: `register.test.ts`의 `main panel shows the version`이 `v1.1.0`을 기대하도록 바꾼다

- [ ] **Step 1: 버전 테스트를 `v1.1.0`으로 바꾸고 FAIL을 확인한 뒤, 두 파일을 `1.1.0`으로 올리고 PASS를 확인한다**

- [ ] **Step 2: 터미널에서 직접 확인**

플러그인을 다시 불러온 세션에서 superpowers 단계를 하나 진행한다. 다음을 눈으로 본다.
- 캐릭터가 100ms마다 움직인다.
- idle이 되면 멈춘다.
- 테두리가 깨지지 않는다.

- [ ] **Step 3: 데스크톱 앱에서 직접 확인** (spec의 "데스크톱 애니메이션 확인")

- 캐릭터와 비트가 CSS로 움직이는지 본다.
- redraw 때 처음부터 다시 시작하지 않고 매끄럽게 도는지 본다.
- 안 되면 `isInteractive: true`를 `Svg`에 넣고 다시 본다.
- 그래도 끊기면 멈추고 사용자에게 "데스크톱에서만 ticker 끄기" 안을 가져온다. 이 안은 임의로 구현하지 않는다.
- 결과(어느 쪽으로 됐는지)를 커밋 메시지에 적는다.

- [ ] **Step 4: README의 SUPERPOWERS 항목에 한 줄 추가**

추가할 문장: 현재 단계는 그 단계의 Clawd가 일하는 카드로 그려지고(생각쟁이·서기·설계사·정원사·건설공·탐정·축하꾼), 에이전트는 역할 색의 로봇 비트(`[•_•]⚙`, 끝나면 `[^_^]✓`, 실패 `[x_x]✗`, 지적 `[o_o]⚠`)로 나오며, 일하는 동안만 움직인다. AGENTS 항목의 아이콘 설명도 비트로 고친다.

- [ ] **Step 5: GIF와 스크린샷을 다시 찍는다**

memory `demo-recording.md`의 절차를 따른다. 중요한 점:
- `screencapture -V`에 SIGINT를 보내지 않는다.
- mock 파일은 scratchpad에 둔다.

- [ ] **Step 6: Commit** — `git commit -m "feat: 캐릭터 README, 데모, 버전 1.1.0"`
