# task-progress 1.0 — 이벤트 기반 재작성 설계

## 의도와 이유

superpowers execute 단계의 모니터링은 몇 차례 고쳤는데도 실제 세션에서 계속 빗나갔다. 원인은 셋이다.

1. **추론 신호가 선택 사항이다.** `dispatched` 줄, `task-start`, 체크박스는 Claude가 건너뛸 수 있는 기록 작업이다. vee-app 세션(2026-11-02)은 `task-start`와 TaskCreate를 둘 다 건너뛰었고, 패널은 `0/2`에 멈췄다.
2. **테스트가 상상한 시나리오였다.** hook이 `fs.read`로 파일을 직접 읽어서 테스트는 파일 내용을 mock해야 했다. 실제 세션 모양은 테스트에 한 번도 들어간 적이 없다.
3. **어떤 코드가 돌고 있는지 보이지 않았다.** vee-app 세션은 0.9.0으로 돌고 있었다.

1.0에서는 패널 전체를 **이벤트 → 순수 reducer → 상태 → 렌더** 구조로 다시 만든다. 이렇게 하면 실제 transcript를 같은 reducer에 재생해서 검증할 수 있다.

## 목표

- **G1 — 흔적 기반 현재 task.** Claude가 어차피 하는 행동(task의 `Files:`에 있는 파일 편집, `task-done`, ledger 기록)으로 현재 task와 완료를 알아낸다.
- **G2 — 경고.** execute 중 현재 task를 모르는 채 파일을 고치면, tool 결과에 어느 task인지 밝히라는 안내를 덧붙인다. **막지는 않는다**(사용자 결정).
- **G3 — 실제 세션 재생 테스트.** 이 Mac의 실제 transcript를 reducer에 재생하고 불변식을 검사한다. **로컬 전용**(사용자 결정)이며, 원본 transcript와 그 파생물은 저장소에 들어가지 않는다.
- **G4 — 버전 표시.** main 패널에 mod 버전을 보여 준다.
- 패널 6개(main, SUPERPOWERS, TASKS, AGENTS, SKILLS, ACTIVITY)는 지금 README에 적힌 대로 보이고 동작한다.

## 비목표

- 패널 모양 변경. G4의 버전 표시만 예외다.
- task 안의 step 단위 진행률.
- 작업 차단(deny).

## 반목표 (이렇게 되면 기술적으로 동작해도 실패)

- 경고가 매 Edit마다 반복돼 Claude의 컨텍스트와 사용자 화면을 어지럽힌다.
- 재생 테스트가 회사 저장소(`malgn-*`) transcript 내용을 저장소에 커밋하거나 출력 파일로 남긴다. 이 저장소는 PUBLIC이다.
- reducer가 시계나 파일시스템을 직접 읽는다. 그러면 재생이 불가능해진다.

## 제약

- Claude Code mod API(`claude-code` 모듈의 `atom`/`read`/`update`, `on(...)` 이벤트, `$.ui`, `$.fs`, `$.clock`). 테스트는 `claude plugin test .`로 돌린다.
- superpowers 7.0.1의 ledger 형식은 바꾸지 않는다. 6.4.1과의 호환(stage 이름, path 단어)은 지금 수준으로 유지한다.
- 이 checkout에는 `.claude-plugin/types/tsconfig.json`이 없어 `tsc`가 돌지 않는다. 검증은 테스트로 한다.

## Approaches (고려한 것)

- **A. 전부 재작성: 이벤트 로그 + 순수 reducer (선택).** 모든 hook은 정규화한 이벤트를 만들고, 상태는 순수 함수 하나로만 바뀐다. 재생이 가장 깔끔하다. 잘 돌던 패널까지 다시 만들어 범위와 위험이 가장 크다.
- B. 기존 구조에 신호와 재생만 추가. 변경은 작지만, hook이 파일을 직접 읽는 구조라 재생 때 시점별 파일 내용을 mock해야 한다. 지금 문제의 원인이 남는다.
- C. superpowers와 plan 추적만 재작성. 위험은 작지만 이벤트 경로가 두 개 공존한다.

사용자가 A를 골랐다.

## 구조

```
hooks (register.tsx)                 transcript (.jsonl)
   │ 정규화                              │ 변환 (replay/fromTranscript.ts)
   ▼                                     ▼
            Ev  (시각 `at`, 관찰한 파일 내용 포함)
                         │
                 step(state, ev) → { state, effects }   ← 순수, 시계·fs 없음
                         │
             state atom 하나 ─→ derive(state, now) → View ─→ view.tsx 렌더
```

- **`Ev`** — 정규화한 이벤트. 모든 이벤트에 `at`(ms)이 있고, 관찰한 파일 내용을 그대로 싣는다. reducer는 바깥을 보지 않는다. 최소 종류:
  - `turn.start` / `turn.end { agentId?, answer, reason, waiting? }`
  - `step { agentId?, model, effort }`
  - `tool { agentId?, tool, input 요약, ok, result 요약 }`
  - `file { path, text }` — 관찰한 파일 내용
  - `skill { name, fromSubagent }`
  - `agent.spawn { agentId, description, subagentType, model }`
  - `usage`, `compact`, `mode`
- **live의 `file` 이벤트.** hook이 main loop tool 호출 뒤 관련 파일(현재 plan, 그 ledger)을 읽어 `file` 이벤트로 넣는다. 지금 `refreshPlan`이 하던 일을 이벤트로 바꾼 것이다.
- **replay의 `file` 이벤트.** transcript에서 만든다. Write의 content, Read 결과, Edit(앞 내용에 적용), Bash 결과 중 ledger 줄(`task-done`의 `ledger: …` 출력), `>> …/progress.md` echo/printf 내용을 쓴다.
- **`step(state, ev)`** — 상태 전이 전부를 맡는 순수 함수. 반환값은 `{ state, effects }`이고, effects는 hook이 실행한다. 이벤트 순서 의존은 이 함수 안에만 있다. effects는 두 가지다.
  - `warn(text)` — tool 결과에 context를 덧붙인다
  - `animate`
- **`derive(state, now)`** — 렌더용 값 계산(시간, 정렬, 자르기). 역시 순수 함수다.
- **atom 하나.** 새 key(`state`)를 쓰고, 지난 버전의 atom들은 읽지 않는다. hot reload를 넘어 이어지는 상태는 이 하나다. 전체 이벤트 로그는 저장하지 않고, 상태가 곧 접은 결과다.
- **`view.tsx`** — 지금의 순수 렌더 함수는 재사용해도 된다. 입력을 `View`로 바꾼다.
- 기존 `plan.ts`, `superpowers.ts`의 순수 함수(파서, `reach`, `pipeline` 등)는 reducer 모듈로 옮기거나 다시 쓴다. 필요 없는 건 지운다.

## 현재 task 판정 (G1)

superpowers plan의 각 task마다, 우선순위대로 처음 맞는 규칙을 쓴다.

1. ledger의 `Task N: dispatched`(SDD, 병렬이면 여러 개)
2. 가장 최근의 `task-start PLAN N` (0.9.2 규칙: 따옴표 허용, 파일명 비교)
3. **가장 최근에 맞은 main loop 편집** — 편집 대상 파일이 아직 안 끝난 task의 `**Files:**` 목록에 있으면 그 task. 편집에는 Edit/Write/NotebookEdit와 **Bash로 바뀐 파일**이 모두 들어간다(아래 "Bash 편집"). **끈적하다(sticky):** 목록에 없는 파일(helper, README, lockfile)을 고쳐도 현재 task는 그대로이고, 그 task가 끝나야 풀린다 — 내 판단: 경고가 잦아지는 반목표를 피한다
   - 목록은 `Create:`/`Modify:`/`Test:` 줄의 백틱 경로다. `:123-145` 같은 줄 범위는 뗀다.
   - repo 기준 상대경로와 절대경로 모두 끝부분 일치로 비교한다.
   - 여러 task에 같은 파일이 있으면, 안 끝난 것 중 번호가 가장 앞선 task를 고른다.
4. 위가 없고, 무언가 끝났거나 체크됐으면 안 끝난 첫 task (기존 규칙)

**Bash 편집.** 실제 세션에서는 Bash로 고친 파일이 Edit/Write보다 4~10배 많다. transcript에서는 Bash 결과의 `toolUseResult.bashEditDiff`(변경 파일 목록)를 쓴다. live에서는 `tool.call` 결과가 바뀐 파일을 알려 주는지 빌더가 먼저 spike로 확인한다. 알려 주지 않으면, 명령에서 `sed -i`, `>`/`>>` 리다이렉트, `tee`의 대상을 뽑아 근사한다 — 내 판단.

완료 판정은 ledger의 `Task N: complete`(목록형 포함, 지금 규칙)와 task의 step 체크박스가 전부 체크된 경우다. 끝난 task는 plan을 다시 읽어도 끝난 채로 남는다(`keepCompleted`). subagent의 Edit는 규칙 3에 쓰지 않는다. SDD에는 규칙 1이 있다.

## 경고 (G2)

조건은 모두 만족해야 한다.
- stage가 `execute`
- 현재 plan이 superpowers plan
- main loop의 편집(Edit/Write/NotebookEdit 또는 Bash 편집)이 성공했고, 대상이 plan, spec, ledger 밖의 파일
- 그 편집 뒤에도 규칙 1~3으로 현재 task가 정해지지 않음

이때 tool 결과에 다음 context를 붙인다.

> task-progress: this edit isn't tied to a plan task. Before working on a task, run `task-start <plan> <N>` (executing-plans) or ledger `Task <N>: dispatched` (subagent-driven-development).

**한 공백 구간에 한 번만** 붙인다. 현재 task가 한 번 정해지면 구간이 끝나고, 다시 모르게 되면 새 구간이 시작된다.

## 버전 (G4)

- 코드에 `VERSION` 상수를 둔다. 테스트 하나가 `.claude-plugin/plugin.json`의 `version`과 같은지 검사한다.
- main 패널 첫 줄 오른쪽에 `v1.0.0`을 흐리게(dim) 붙인다.
- 버전은 1.0.0이다.

## 재생 테스트 (G3)

- `replay/fromTranscript.ts` — transcript `.jsonl`(그리고 같은 세션의 `subagents/` 아래 파일)을 `Ev[]`로 바꾼다. 커밋되는 코드다.
- `hooks/replay.local.test.ts` — `claude plugin test .`에 함께 돈다.
  - `~/.claude/projects/*/*.jsonl` 중 `superpowers:executing-plans` 또는 `superpowers:subagent-driven-development`를 담은 세션을 찾는다.
  - 경로 대신 `REPLAY_DIR` 환경변수를 줄 수 있다.
  - 대상이 없으면(다른 기계, CI) skip한다.
- 출력에는 세션 파일명과 위반 종류, 이벤트 번호만 남긴다. **transcript 내용(명령, 경로, 대화)은 출력하지 않고, 파일로도 남기지 않는다.**
- **plan 본문의 출처** — 내 판단. transcript에서 plan이 Write나 Read로 보이면 그 내용을 쓴다. Bash `cat`으로만 봤다면, plan 경로가 처음 나온 시점에 테스트 계층(reducer 아님)이 디스크의 현재 plan을 `file` 이벤트로 넣는다. task 제목은 실행 중에 거의 바뀌지 않기 때문이다. 디스크에도 없으면 그 세션은 `skipped: no plan`으로 보고만 한다.
- 각 세션을 reducer에 접으며 검사하는 불변식:
  1. **I1 공백 없음 (경고 회귀 검사).** execute 중이고 superpowers plan이 있으며 모든 task가 끝나기 전, main loop 편집이 생기면 다음 둘 중 하나여야 한다. 기준은 stage가 execute에 들어간 시점이고, `dispatched`나 `task-start`를 기다리지 않는다.
     - 그 시점에 규칙 1~3으로 현재 task가 정해져 있다.
     - 그 공백 구간에 경고가 나갔다.

     편집 없는 공백(Bash 실행, Read, 테스트만 있는 구간)은 검사하지 않는다.
  2. **I2 단조.** 같은 plan의 완료 수는 줄지 않는다. stage는 한 cycle 안에서 뒤로 가지 않는다.
  3. **I3 끝 일치.** plan마다 비교한다. 세션 끝의 완료 수가 "완료 증거가 있는 task 수"와 같아야 한다 — 내 판단. 증거로 치는 것은 두 가지다.
     - 그 plan의 ledger에 쓴 흔적(`task-done`의 `ledger:` 출력, `progress.md`로 가는 echo/printf, `progress.md`의 Write/Edit)에 든 `Task N: complete`
     - 마지막 plan 본문에서 step이 전부 체크된 task

     skill 본문, subagent prompt, plan 템플릿에 나온 문구는 치지 않는다.
  4. **I4 무사.** 변환과 reducer가 예외 없이 끝난다.
- 위반이 하나라도 있으면 테스트는 실패한다.
- **연결 비율 (지표, 실패 조건 아님).** 세션마다 "execute 중 main loop 편집 가운데 규칙 1~3으로 task에 연결된 비율"을 출력한다. 예전 세션은 경고 없이 녹화됐으니 이 숫자는 판정 규칙을 개선할 곳을 가리키는 지표다. 기준선은 두지 않는다(사용자 결정).
- 기존 테스트 중 동작을 확인하는 것(ledger 파싱, 단계, agent 역할, 렌더)은 reducer와 렌더 단위로 옮긴다. mock한 `fs.read`에 기대던 시나리오 테스트는 `Ev[]`를 직접 만들어 넣는 방식으로 바꾼다.

## 빌더에게 맡긴 것

- `Ev`의 정확한 필드, 모듈 나누기, 파일 이름. 단, 위 구조와 순수성 경계는 지킨다.
- transcript 형식의 세부(어떤 필드에서 tool 결과·시각·agentId를 얻는지)는 실제 파일을 읽고 정한다.
- `view.tsx`를 얼마나 재사용할지.
- README 갱신(1.0 구조, 버전 표시, 경고, 로컬 재생 테스트 실행법).
