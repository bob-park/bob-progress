# 하얀 배경, 터미널 꼬마 Clawd, 별명 위치, 데스크톱 막대 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1.2.0을 실제로 써 보니 다섯 가지 문제가 나왔다.
- 하얀 배경에서 SUPERPOWERS 영역이 잘 안 보인다.
- 터미널 에이전트 줄에 작은 캐릭터가 없다.
- 단계 사이 여백이 없다.
- 별명 위치가 애매하고, execute 카드에서는 별명이 아예 빠진다.
- 데스크톱 막대가 보이지 않는다.

이 다섯 가지를 고친다.

**Architecture:**
- 그리는 코드(`hooks/view.tsx`, `hooks/characters.ts`)와 `hooks/register.tsx`의 gap만 바꾼다. 상태와 reducer는 그대로 둔다.
- 색은 테마 키로 바꾼다. SVG는 CSS `prefers-color-scheme`으로 밝은 배경을 따로 처리한다.
- 데스크톱 막대는 SVG 대신 배경색을 칠한 Box로 그린다.

**Tech Stack:** TSX, Claude Code mod 렌더 API, `claude-code/testing`

**Spec:** `docs/superpowers/specs/2026-11-02-theme-terminal-chars-design.md`
- 목업: `docs/superpowers/specs/2026-11-02-theme-terminal-chars-mockup.html`의 C와 T1

## Global Constraints

- 브랜치는 `fix/theme-terminal-chars`이다. 새 의존성은 들이지 않는다.
- 테스트는 `claude plugin test .`(지금 129개 통과)와 `bun test replay`로 돌린다.
- 터미널 줄은 46칸 패널에서 42칸을 넘지 않는다. 지금 있는 검사를 그대로 유지한다.
- SVG `source`는 프레임 번호나 시계와 무관해야 한다. CSS는 `.tp` 아래로만 적용한다.
- 테마 키는 `Color = ThemeKey | string`이다. 사용하는 키는 `success`, `warning`, `suggestion`, `error`, `text`, `inactive`이다.

## Review Focus

- **어두운 배경에서 지금보다 덜 보이면 안 된다.**
  - 테마 키는 어두운 테마에서도 원래 색과 비슷하게 나와야 한다. 자동 테스트로는 볼 수 없으니 Task 6에서 눈으로 확인한다.
- **데스크톱 막대의 경계 상태**
  - done=0, active=0이면 남은 칸 Box 하나만 그린다.
  - 다 끝났으면 완료 Box 하나만 그린다.
  - Task 3에서 테스트한다.
- **T1 얼굴 조각은 배경색이 있는 Text이다.**
  - waiting·done·failed·issues는 프레임이 바뀌어도 모양이 같아야 한다.
  - Task 1에서 테스트한다.
- **execute 카드 4줄**
  - 별명, 머리, 막대, 작업이 캐릭터 4줄과 맞아야 한다.
  - 다섯 번째 줄이 생기거나 42칸을 넘으면 안 된다.
  - Task 2에서 테스트한다.
- **좁은 터미널(`bodyColumns` 34)**
  - 카드 대신 일반 줄로 그린다. 이때 별명은 나오지 않는다(지금과 같음).
  - 에이전트 줄은 T1 7칸을 쓴다.
  - Task 1에서 테스트한다.

---

### Task 1: 터미널 에이전트 줄을 T1 꼬마 Clawd로

**Files:**
- Modify: `hooks/characters.ts`(`Seg`, `BOT`, `botFrame`)
- Modify: `hooks/view.tsx`(`agentRow`의 터미널 경로)
- Test: `hooks/characters.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Produces:
  - `type Seg = { text: string; color: string; bg?: string }`
  - `botFrame(kind: BotKind, f: number, status: BotStatus): Seg[]`
    - 조각 4개, 순서는 `▐`, 얼굴 3칸, `▌`, 도구+여백이다.
    - 칸 수를 모두 더하면 `BOT_W`(7)이다.

**모양**
- 얼굴 조각: `{ text: face, color: '#1F1E1D', bg: '#D97757' }`
- `▐`와 `▌`: 역할 색이다. 역할 색은 지금 `BOT[kind].c`를 쓴다.
- 도구 칸: 도구 글자 1칸 + 공백 1칸이다. 색은 아래 표를 따른다.

| 상태 | 얼굴 | 도구 | 도구 색 |
|---|---|---|---|
| running | `•_•` | f에 따라 3틱마다 번갈아 바뀜. impl `⚙`/`✲`, review `⌕`/`⌕`, fix `✚`/`✚`, agent `»`/`»` | 역할 색 |
| waiting | `-_-` | `z` | 역할 색 |
| done | `^_^` | `✓` | `success` |
| failed | `x_x` | `✗` | `error` |
| issues | `o_o` | `⚠` | `warning` |

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `characters.test.ts`의 `botFrame` 테스트를 아래로 바꾼다.

```ts
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
```

  - `register.test.ts`에서 `[•_•]`나 `\[\S+\]` 글자 비트를 찾는 검사를 새 모양 `▐\S{3}▌`으로 바꾼다. `unbit`, "a plain agent under AGENTS draws as a green bit", "each stage keeps its agents" 등이 해당한다.
    - 녹색 비트 테스트는 `▐` 조각의 color가 `'#1D9E75'`인지 보도록 바꾼다.
    - 배경색 검사도 하나 추가한다. `(await ui.findAll({ text: /^•_•$/ }))[0]?.props.backgroundColor`가 `'#D97757'`이어야 한다.

- [ ] **Step 2: `claude plugin test .`를 돌려서 새 검사가 실패하는지 확인한다**

- [ ] **Step 3: 구현한다**
  - 위 표대로 `botFrame`을 바꾸고, `Seg`에 `bg?`를 추가한다.
  - `agentRow`의 터미널 경로는 조각마다 `<Text color={s.color} backgroundColor={s.bg}>`로 그린다.

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**
  - 42칸 검사도 통과해야 한다.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "feat: 터미널 에이전트 줄을 한 줄 꼬마 Clawd로"`

### Task 2: 카드 오른쪽 열을 별명, 머리, 막대, 작업 순서로 (C)

**Files:**
- Modify: `hooks/view.tsx`(`card`의 `right` 배열)
- Test: `hooks/register.test.ts`

**Interfaces:**
- `right` 배열의 순서를 아래처럼 바꾼다. 터미널은 캐릭터 i번째 줄 옆에 `right[i]`를 그리고, 데스크톱은 오른쪽 열에 위에서부터 그린다. 이 방식은 지금과 같다.
  - `withPlan`: `[별명, 머리, 막대, 작업]`
  - 그 밖: `[별명, 머리]`
- 별명은 `<Text key="name" bold wrap="truncate">`로 그린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `toExecute`로 준비하고 terminal로 mount한다.
  - 캐릭터 첫 줄 Text(`/▄███▄/`를 담은 줄)에 `망치 대장장이`가 있어야 한다.
  - `/▐▛███▜▌/`를 담은 줄에는 `execute`가 있어야 한다.
  - 모든 Text는 42칸 이하여야 한다.
  - 데스크톱에서는 mount한 뒤 `/^망치 대장장이$/`인 Text가 굵게(`bold`) 있어야 한다.

- [ ] **Step 2: 실패하는지 확인한다**
  - 지금은 execute 카드에 별명이 없으므로 실패해야 한다.

- [ ] **Step 3: `right` 배열을 위 순서로 바꾼다**

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**
  - 기존 "a non-execute stage card fits" 테스트도 통과해야 한다. 별명 위치만 바뀌기 때문이다.

- [ ] **Step 5: 커밋한다**
  - `git commit -m "feat: 카드 첫 줄에 별명, execute에서도"`

### Task 3: 데스크톱 막대를 배경색 Box로

**Files:**
- Modify: `hooks/view.tsx`(`barLine`의 Svg 분기)
- Modify: `hooks/characters.ts`(`barSvg` 삭제)
- Test: `hooks/characters.test.ts`(`barSvg` 테스트 4개 삭제), `hooks/register.test.ts`

**Interfaces:**
- 함수 시그니처는 그대로 두고 `barLine`의 Svg 분기만 바꾼다.
  - 바깥 Box: `<Box flexGrow={1} flexDirection="row" height={1}>`
  - 안쪽 Box: done/active/todo 중 0보다 큰 것만 그린다. 각각 `<Box flexGrow={n} backgroundColor={'success'|'warning'|'inactive'} />`
- 앞뒤 Text(`before`, 개수와 `after`)는 지금 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - 기존 desktop 막대 테스트(46칸과 34칸, TASKS)에서 "막대 Svg 1개" 검사를 바꾼다. 새 검사는 아래와 같다.
    - `backgroundColor`가 있는 Box가 있다.
    - alt가 `n/3` 꼴인 Svg는 없다.
    - `█`, `▓`, `░` 글자는 없다.
  - 경계 테스트를 추가한다. plan이 막 시작된 경우와 다 끝난 경우(execute가 끝나 finish로 간 상태)에서, 배경색 Box는 각각 정확히 1개이다.

- [ ] **Step 2: 실패하는지 확인한다**

- [ ] **Step 3: 구현하고, `barSvg`와 그 테스트, import를 지운다**

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**

- [ ] **Step 5: 커밋한다**
  - `git commit -m "fix: 데스크톱 막대를 배경색 Box로 그려 항상 보이게"`

### Task 4: 하얀 배경 대응 (테마 키와 SVG 밝은 색)

**Files:**
- Modify: `hooks/view.tsx`(SUPERPOWERS, TASKS, AGENTS, `planBar`, `planNow`, `spNow`, `TONE`, `COLOR`, `STAGE_COLOR`, `agentRow`)
- Modify: `hooks/characters.ts`(`C.fg` → `'text'`, `botFrame`의 상태 색, `layer`, `CSS`)
- Test: `hooks/characters.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- 색을 아래처럼 바꾼다.
  - 이 세 섹션 안의 `'yellow'` → `'warning'`, `'green'` → `'success'`, `'blue'` → `'suggestion'`, `'red'` → `'error'`
  - `COLOR`의 `waiting: 'cyan'`과 `AGENTS` 머리의 `'magenta'`는 그대로 둔다. 하얀 배경에서도 읽히는 색이라서다.
- `TONE` 대신 강조 방식을 바꾼다.
  - hi: `{ color: 'warning', bold: true, inverse: true }`
  - mid: `{ color: 'warning', bold: true }`
  - base: `{ color: 'warning' }`
  - `shimmer()`의 반환 모양(`tone`)은 그대로 둔다.
- `layer()`는 `W`, `w`, `L`, `u` 픽셀 rect에 `class="pW"`, `"pw"`, `"pL"`, `"pu"`를 붙인다.
- `CSS`에는 아래 규칙을 추가한다.
  - `@media (prefers-color-scheme: light){.tp .pW{fill:#4a4843}.tp .pw{fill:#7d7a72}.tp .pL{fill:#2f6f9f}.tp .pu{fill:#4a7fb5}}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - **register**: `toExecute`로 준비하고 terminal과 desktop으로 mount한다. 모든 Text의 `props.color`가 `['yellow','green','blue','red']`에 없어야 한다. 단 main, SKILLS, ACTIVITY 섹션의 Text는 빼고 본다.
    - 걸러내는 방법은 이렇다. `findAll({ type: 'Box' })`에서 `borderColor`가 `'cyan'`, `'blue'`, `'gray'`인 섹션 Box를 찾는다. 그 Box의 text에 들어 있는 Text는 제외한다.
    - 더 간단하게 걸러낼 방법이 있으면 Ruling으로 남기고 그걸 쓴다.
  - **characters**: `stageSvg('spec', 4, false).source`에 `prefers-color-scheme: light`와 `class="pW"`가 들어 있어야 한다.
  - **characters**: `stageFrame('spec', 0, true)`의 소도구 색이 `'text'`여야 한다.
  - 기존 "sprite CSS is scoped" 테스트는 그대로 통과해야 한다.
  - 기존 검사 가운데 `color`가 `'blue'`나 `'yellow'`이기를 기대하는 것은 새 키로 바꾼다. `/^ ?1\/3$/`의 `'blue'`, `/^▓+$/`의 `'yellow'`가 해당한다.

- [ ] **Step 2: 실패하는지 확인한다**

- [ ] **Step 3: 구현한다**

- [ ] **Step 4: `claude plugin test .`가 모두 통과하는지 확인한다**

- [ ] **Step 5: 커밋한다**
  - `git commit -m "fix: 하얀 배경에서도 보이게 테마 색과 밝은 스프라이트 색"`

### Task 5: 여백 md, 1.2.1, README

**Files:**
- Modify: `hooks/register.tsx`(바깥 Box의 `gap`)
- Modify: `hooks/view.tsx`(단계 묶음 Box의 `gap`)
- Modify: `hooks/version.ts`, `.claude-plugin/plugin.json`
- Modify: `README.md`
- Test: `hooks/register.test.ts`(gap 테스트, 버전 문자열)

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - gap 테스트의 기대값을 `'md'`로 바꾸고, 테스트 이름에서 "0 rows"를 "1 row"로 바꾼다.
  - `v1\.2\.0`을 `v1\.2\.1`로 바꾼다.

- [ ] **Step 2: 실패하는지 확인한다**

- [ ] **Step 3: 구현한다**
  - 두 Box의 gap을 `"md"`로 바꾼다.
  - 버전을 1.2.1로 올린다.
  - README를 고친다.
    - 비트 설명을 터미널 `▐•_•▌⚙`(`▐^_^▌✓` done, `▐x_x▌✗` failed, `▐o_o▌⚠` issues, `▐-_-▌z` waiting)로 바꾼다.
    - 카드 첫 줄이 별명이라는 점을 적는다.
    - 하얀 배경에서는 테마 색을 따른다는 점을 적는다.
    - 데스크톱 막대 설명은 "drawn to fit the row"를 유지한다.
    - `v1.2.0`을 `v1.2.1`로 바꾼다.

- [ ] **Step 4: `claude plugin test .`와 `bun test replay`가 모두 통과하는지 확인한다**

- [ ] **Step 5: 커밋한다**
  - `git commit -m "fix: 터미널에도 단계·섹션 여백, 1.2.1"`

### Task 6: 머지 전 확인 (필수, 사용자)

- [ ] **Step 1: 브랜치 전체 검토**
  - 새 reviewer가 브랜치 전체를 검토한다.
  - Critical과 Important는 한 번에 고친다.
- [ ] **Step 2: 사용자가 이 브랜치를 로컬 마켓플레이스로 띄워 확인한다**
  - 하얀 배경 터미널과 어두운 배경 터미널, 그리고 데스크톱 앱(가능하면 밝은 모드)에서 본다.
  - 확인할 것: 별명 C 위치, T1 캐릭터, 단계 사이 여백, 데스크톱 막대, 어두운 배경에서 색이 탁해지지 않았는지
- [ ] **Step 3: 확인을 통과하면 PR을 만들고 머지한다**
