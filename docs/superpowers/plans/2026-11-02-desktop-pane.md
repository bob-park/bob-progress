# 데스크톱 패널 수정과 꼬마 Clawd 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 앱에서 깨지는 세 가지(캐릭터 정지, 카드 여백 없음, execute 막대 넘침)를 고친다. 에이전트 아이콘을 꼬마 Clawd로 바꾸고, 단계 별명을 RPG 직업으로 바꿔 굵게 표시한다.

**Architecture:**
- 데스크톱 분기는 지금처럼 `svgOf(ui, v)`로 한다.
- 움직이는 SVG에만 `isInteractive: true`를 붙인다.
- 막대는 데스크톱에서만 SVG로 그리고 남은 폭을 채운다.
- 터미널 출력은 별명 말고는 바꾸지 않는다.

**Tech Stack:** TypeScript/TSX, Claude Code mod 렌더 API(`claude-code`), 테스트는 `claude-code/testing`

**Spec:** `docs/superpowers/specs/2026-11-02-desktop-pane-design.md`
- 목업: `docs/superpowers/specs/2026-11-02-desktop-pane-mockup.html`의 A, `docs/superpowers/specs/2026-11-02-stage-names-mockup.html`의 C

## Global Constraints

- 브랜치는 `fix/desktop-pane`이다.
- 새 의존성은 들이지 않는다.
- SVG `source`는 프레임 번호(`v.f`)나 시계와 무관해야 한다. 같은 입력이면 같은 문자열이 나와야 한다. 131072자를 넘지 않는다.
- 모든 SVG CSS는 루트 `class="tp"` 아래로 범위를 한정한다. `@media (prefers-reduced-motion: reduce)`이면 애니메이션을 끈다.
- 터미널 출력은 단계 별명 말고는 바뀌지 않는다. 기존 터미널 테스트는 그대로 통과해야 한다.
- 테스트 명령은 `claude plugin test .`이고, 지금 118개가 통과한다.

## Review Focus

- **좁은 데스크톱 패널(`bodyColumns` 34)에서도 막대가 한 줄에 들어가야 한다.** 데스크톱은 폭과 상관없이 현재 단계를 카드로 그린다. 그래서 34칸에서는 막대가 카드 오른쪽 열(16칸)에 들어간다. Task 3에서 34와 46 두 폭을 테스트한다. (최종 검토에서 전제를 고침)
- **plan이 막 시작된 경우(done 0, active 0)와 다 끝난 경우(done = total)에도 막대 SVG가 깨지면 안 된다.** 길이 0인 rect나 NaN이 생기면 안 된다. Task 3에서 테스트한다.
- **idle(busy 아님) 상태의 데스크톱 막대와 캐릭터는 `isInteractive`가 없어야 한다.** 그래야 frame이 남지 않는다. Task 2와 3에서 테스트한다.
- **TASKS 섹션 막대**(`progressLines`)도 같은 `planBar`를 쓴다. 그래서 데스크톱에서 같이 고쳐진다(내 판단). Task 3에서 테스트한다.
- **AGENTS 섹션의 일반 에이전트**가 초록 모자 꼬마 Clawd로 나와야 한다. Task 2에서 테스트한다.

---

### Task 1: 단계 별명을 RPG 직업으로 바꾸고 굵게 표시

**Files:**
- Modify: `hooks/characters.ts:16` (`STAGE_NAME`)
- Modify: `hooks/view.tsx` (`card`의 `<Text key="name" dimColor>`)
- Modify: `hooks/register.test.ts:861` (`/생각쟁이/`), `hooks/register.test.ts` desktop alt 테스트의 `'execute · 건설공'`
- Modify: `README.md:11`

**Interfaces:**
- Produces: `STAGE_NAME: Record<Stage, string>` (값만 바뀐다)

- [ ] **Step 1: 기존 테스트를 새 별명으로 바꿔서 실패하게 만든다**
  - `register.test.ts`의 `/생각쟁이/`를 `/꿈꾸는 현자/`로 바꾼다.
  - `'execute · 건설공'`을 `'execute · 망치 대장장이'`로 바꾼다.
  - "a non-execute stage card fits the terminal pane" 테스트에 아래를 추가한다.

```ts
expect((await ui.find({ text: /꿈꾸는 현자/ }))?.props.bold).toBe(true)
expect((await ui.find({ text: /꿈꾸는 현자/ }))?.props.dimColor).toBeFalsy()
```

- [ ] **Step 2: `claude plugin test .`를 돌려서 실패를 확인한다**
  - Expected: 위 테스트 2개가 FAIL한다.

- [ ] **Step 3: 구현한다**
  - `STAGE_NAME`을 `{ brainstorm: '꿈꾸는 현자', spec: '필경사', plan: '대마법 건축가', worktree: '숲의 드루이드', execute: '망치 대장장이', review: '그림자 추적자', finish: '축제 음유시인' }`로 바꾼다.
  - 카드의 별명 Text에서 `dimColor`를 빼고 `bold wrap="truncate"`를 준다.
  - README의 `thinker · scribe · … : 생각쟁이 · … · 축하꾼`을 `sage · scribe · archmage architect · druid · blacksmith · shadow tracker · bard: 꿈꾸는 현자 · 필경사 · 대마법 건축가 · 숲의 드루이드 · 망치 대장장이 · 그림자 추적자 · 축제 음유시인`으로 바꾼다.

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**
  - Expected: 0 fail.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "feat: 단계 별명을 RPG 직업으로, 굵게"`

### Task 2: 에이전트 아이콘을 꼬마 Clawd로, 움직이는 SVG에 isInteractive

**Files:**
- Modify: `hooks/characters.ts` (`botSvg`, `ROLE_PX`, `MARK`, `BOT_PX`, `CSS`, `stageSvg`)
- Test: `hooks/characters.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Produces:
  - `botSvg(kind: BotKind, scale: number, status: BotStatus): { source: string; width: number; height: number; alt: string; isInteractive?: true }`
  - `stageSvg(stage: Stage, scale: number, on: boolean)`도 같은 모양의 객체를 돌려준다. `isInteractive: true`는 `on`일 때만 붙는다.
  - 두 함수 모두 `view.tsx`에서 `<Svg {...} />`로 그대로 펼쳐 쓴다. 호출부는 바꾸지 않는다.

**스프라이트(목업 A에서 그대로 옮긴다)**
- 격자: viewBox `0 -1 18 10`, 크기 `18*scale × 10*scale`. 2배면 36×20이다.
- 몸(14칸 너비, 9줄; `H`는 역할 색, `#`는 clay `#D97757`):
  ```
  ....HHHHHH....
  ...HHHHHHHH...
  ..##########..
  ..##########..
  ##############
  ..##########..
  ..##########..
  ..#.#....#.#..   ← 아래 2줄은 다리. hop 그룹 밖에 둔다.
  ..#.#....#.#..
  ```
- 역할 색: impl `#378ADD`, review `#E0A030`, fix `#E5534B`, agent `#1D9E75`(지금 `ROLE_PX`의 색 그대로).
- 눈은 3×2 픽셀이고 색은 `K`이다. 위치는 (3,2)와 (8,2)이다.
  - running `['.K.','.K.']`
  - waiting `['...','KKK']`
  - done `['.K.','K.K']`
  - failed `['K.K','.K.']`
  - issues `['KKK','K.K']`
- 도구(15,2)는 지금 `ROLE_PX.tool`을 그대로 쓴다. agent는 도구가 없다. 도구는 `class="tool"` 그룹에 넣는다.
- 상태 표시는 지금 `MARK`를 그대로 쓴다. 도구 자리 (15,2)에 그리는데, 4줄짜리(issues)는 y를 1 올린다.
- 움직임은 running일 때만이다.
  - 몸+눈+도구 그룹이 `hop`으로 깡충거린다(지금 CSS를 그대로 쓴다).
  - 도구는 `.tp.on .tool{transform-box:fill-box;transform-origin:0 100%;animation:wig .6s steps(1) infinite}@keyframes wig{50%{transform:rotate(-20deg)}}`로 까딱인다. 이 규칙을 `CSS`에 추가한다.
  - 안테나 `ant` 규칙은 쓰는 곳이 없어지면 지운다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `characters.test.ts`의 `botSvg` 테스트에서 크기 기대값을 `[36, 20]`로 바꾼다.
  - 아래 테스트를 추가한다.

```ts
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
```

  - `register.test.ts`의 "a plain agent under AGENTS" 옆에 desktop 버전을 추가한다.
    - 같은 준비를 한 뒤 `surface: 'desktop'`으로 mount한다.
    - `(await ui.findAll({ type: 'Svg' })).find(s => s.props.alt === 'agent running')?.props.source`에 `'#1D9E75'`이 들어 있는지 본다.

- [ ] **Step 2: `claude plugin test .`를 돌려서 새 테스트가 실패하는지 확인한다**

- [ ] **Step 3: 구현한다**
  - 위 스프라이트대로 `botSvg`를 다시 쓴다.
  - `layer()`, `svgDoc()`, `MARK`, `ROLE_PX.tool`은 그대로 다시 쓴다. 눈과 몸 정의만 새로 만든다.
  - `stageSvg`와 `botSvg`는 움직일 때만 `isInteractive: true`를 붙인다. `...(on ? { isInteractive: true as const } : {})` 형태로 붙인다.

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**
  - 기존 "sprite CSS is scoped" 테스트도 통과해야 한다. 그래서 새 `.tool` 규칙도 `.tp` 아래에 둔다.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "feat: 데스크톱 에이전트 아이콘을 꼬마 Clawd로, 움직이는 SVG는 interactive"`

### Task 3: 데스크톱 plan 막대를 SVG로 그려 한 줄에 맞추기

**Files:**
- Modify: `hooks/characters.ts`(`barSvg` 추가)
- Modify: `hooks/view.tsx`(`planBar` 호출부 세 곳: `card`의 `bar`, `plainRow`의 execute, `progressLines`)
- Test: `hooks/characters.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `svgOf(ui, v)`(이미 있음), Task 2의 `isInteractive` 규칙
- Produces:
  - `barSvg(done: number, active: number, total: number, on: boolean): { source: string; height: number; alt: string; isInteractive?: true }`. `width`는 없다.
  - `view.tsx`의 `barLine(ui: UI, key: string, before: JSX.Element[], list: Task[], barW: number, after: JSX.Element[], v: Frame): JSX.Element`
    - 터미널은 지금처럼 `<Text wrap="truncate">{before}{planBar(...)}{after}</Text>`를 돌려준다.
    - 데스크톱은 `<Box flexDirection="row" gap={1} alignItems="center">`를 돌려준다. 안에는 `[Text before]`, `[Box flexGrow={1}: <Svg {...barSvg} />]`, `[Text ' done/total' + after]`가 들어간다.
    - 세 호출부는 이 함수를 쓴다.

**`barSvg` 규칙**
- viewBox는 `0 0 100 6`이고 `preserveAspectRatio="none"`이다. `height`는 10이다.
- 초록 `#5fbf8f`, 노랑 `#f2c94c`, 회색 `#3a3833` rect를 `x`와 `width`를 백분율로 나눠 그린다. 터미널 막대와 같은 색 의미이다.
  - done 폭 = `done/total*100`
  - active 폭 = `active/total*100`
  - 폭이 0인 rect는 그리지 않는다.
- `on && active > 0`이면 노랑 구간 안에서 밝은 띠(`#fff3c4`, 폭 4)가 CSS keyframes로 좌우로 지나간다.
  - CSS는 `.tp.on` 아래에 두고, `prefers-reduced-motion`이면 끈다.
  - 이때만 `isInteractive: true`를 붙인다.
- `alt`는 `` `${done}/${total}` ``이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
test('barSvg: segments by share, no empty rect, stable, moves only with active work', () => {
  const a = barSvg(3, 1, 7, true)
  expect(a.source).toContain('#5fbf8f')
  expect(a.source).toContain('#f2c94c')
  expect(a.source).toContain('prefers-reduced-motion')
  expect(a).toEqual(barSvg(3, 1, 7, true))
  expect(a.isInteractive).toBe(true)
  expect(barSvg(3, 1, 7, false).isInteractive).toBeUndefined()
  expect(barSvg(3, 0, 7, true).isInteractive).toBeUndefined()
  expect(barSvg(0, 0, 7, false).source).not.toContain('#5fbf8f')
  expect(barSvg(7, 0, 7, false).source).not.toContain('#3a3833')
  for (const s of [barSvg(0, 0, 7, false), barSvg(7, 0, 7, true)]) expect(s.source).not.toMatch(/NaN|width="0"/)
})
```

  - `register.test.ts`에 아래 테스트를 추가한다. `toExecute`로 준비하고, `bodyColumns` 46과 34에서 `surface: 'desktop'`으로 mount한다.
    - 막대 Svg(`alt`가 `/^\d+\/3$/`)가 정확히 1개 있다.
    - 막대 글자(`█`, `▓`, `░`)를 담은 Text가 없다.
    - `/ \d\/3/`가 들어 있는 Text가 있다.
  - TASKS 섹션도 테스트한다. 기존 "tasks panel shows done/total" 테스트처럼 todo를 만든 뒤 desktop으로 mount하고, 막대 Svg가 있고 `█`를 담은 Text가 없는지 본다.
  - terminal 테스트는 그대로 두어서 글자 막대가 유지되는지 지킨다.

- [ ] **Step 2: `claude plugin test .`를 돌려서 새 테스트가 실패하는지 확인한다**

- [ ] **Step 3: `barSvg`와 `barLine`을 구현하고, 세 호출부를 `barLine`으로 바꾼다**
  - 터미널 경로의 결과는 지금 JSX와 같은 문자열이어야 한다.
  - `progressLines`의 ` · NN%`는 `after`로 넘긴다.
  - `plainRow`의 시간은 `after`로 넘기고, 머리(`✓ execute `)는 `before`로 넘긴다.

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**
  - 기존 terminal 테스트와 "on desktop a done execute row … keeps its count and time" 테스트도 통과해야 한다.
  - 이 desktop 테스트가 막대 Text를 전제로 한다면 count와 시간을 뒤쪽 Text에서 찾도록 고친다. 고친 이유는 커밋 메시지에 적는다.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "fix: 데스크톱 plan 막대를 SVG로 그려 한 줄에 맞춤"`

### Task 4: 카드 사이 여백, 버전, README

**Files:**
- Modify: `hooks/register.tsx`(`ui.render`의 바깥 `<Box flexDirection="column">`)
- Modify: `hooks/version.ts`, `.claude-plugin/plugin.json`(`1.1.0` → `1.2.0`)
- Modify: `README.md`
- Test: `hooks/register.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - 터미널과 데스크톱 각각에서 패널을 mount하고, `(await ui.find({ type: 'Box' }))?.props.gap`이 `'sm'`인지 본다.
  - `replay/version.spec.ts`는 `VERSION`과 `plugin.json`이 같은지만 본다. 두 곳을 함께 올리면 된다.

- [ ] **Step 2: `claude plugin test .`를 돌려서 실패를 확인한다**

- [ ] **Step 3: 구현한다**
  - 바깥 Box에 `gap="sm"`을 준다. 터미널에서 sm의 세로 간격은 0줄이라 화면이 그대로다.
  - 버전을 1.2.0으로 올린다.
  - README는 세 군데를 고친다.
    - `v1.1.0`을 `v1.2.0`으로 바꾼다.
    - "each agent as a robot bit … On desktop they are pixel sprites animated with CSS"에 데스크톱 설명을 넣는다. "on desktop each agent is a little Clawd in its role's colour hat, its face showing the status"이다.
    - "on desktop the plan bar is drawn to fit the row"를 한 구절 덧붙인다.

- [ ] **Step 4: `claude plugin test .`와 `bun test replay`가 모두 통과하는지 확인한다**
  - replay는 세션이 없으면 skip된다.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "fix: 데스크톱 카드 사이 여백, 1.2.0"`

### Task 5: 실제 데스크톱 앱에서 확인 (필수, 수동)

**Files:** 없음(확인만 한다)

- [ ] **Step 1: 이 브랜치의 플러그인을 데스크톱 앱 세션에 띄운다**
  - 개발 중인 플러그인을 로드하는 기존 방법을 쓴다(이전 GIF를 녹화할 때 쓴 방법).
  - 직접 띄울 수 없으면 사용자에게 열어 달라고 요청하고, 아래 체크리스트를 넘긴다.
- [ ] **Step 2: superpowers 흐름을 execute까지 진행한 상태에서 네 가지를 확인한다**
  - ① 단계 캐릭터와 running 꼬마 Clawd가 움직인다.
  - ② 1~2초 동안 봐도 애니메이션이 처음 프레임으로 되돌아가지 않는다.
  - ③ 섹션 카드 사이에 여백이 있다.
  - ④ 패널을 좁혔다가 넓혀도 execute 막대가 한 줄에 들어간다.
- [ ] **Step 3: 결과를 보고한다**
  - ②가 실패하면 고치지 말고 사용자에게 가져온다. 데스크톱에서 ticker를 끄면 스피너도 멈추므로, 그 결정은 사용자가 한다.
  - ①, ③, ④가 실패하면 원인을 적어서 해당 Task로 돌아간다.
