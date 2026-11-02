# 직접 실행(executing-plans)의 현재 task 표시 — 설계 (small change)

## 의도

superpowers 7.0.1 `executing-plans`로 plan을 직접 실행하면 execute 진행률이 `0/N`에 멈춘 채 현재 task 줄이 뜨지 않는다.
현재 task를 알려주는 근거(SDD ledger의 `Task N: dispatched`, plan 체크박스 `- [x]`, impl/review agent)가 이 흐름에는 하나도 없기 때문이다.
vee-app 세션(2026-11-02)에서 확인했다. ledger에는 `Task 1: Ruling: …` 한 줄뿐이었고, 0.9.1 파서도 두 task를 모두 `pending`으로 냈다.

별개 원인으로, 그 세션은 0.9.0(PR #7 이전)으로 돌고 있었다. 이건 재시작/업데이트 문제라서 코드로 고칠 일이 아니다.

## 목표

- 직접 실행 중 현재 task 이름이 뜬다: `▸ #1 Real run against the dev app`
- 막대는 지금처럼 ledger의 `Task N: complete`로 한 칸씩 찬다

## 비목표

- task 안의 step 단위 진행률
- Claude에게 ledger나 체크박스를 쓰라고 지시를 끼워 넣는 것

## Approaches

- A. execute 단계에서 안 끝난 첫 task를 현재로 본다. 단순하고 호출에 기대지 않지만, 순서를 건너뛰면 틀린다.
- **B. `task-start PLAN N` 명령을 보고 N을 현재로 본다 (선택).** executing-plans가 task마다 부르도록 정한 스크립트라 가장 정확하다. Claude가 이 스크립트를 건너뛰면 아무것도 뜨지 않는다는 한계가 있다.
- C. 시작 줄을 쓰라는 지시를 끼워 넣는다. superpowers ledger 형식 밖이고 Claude가 따를지도 보장되지 않는다.

사용자가 B를 골랐다.

## 동작

- main loop의 Bash 호출이 성공하고 command에 `task-start <plan> <N>`이 있으면(N은 `3b`처럼 쓰일 수 있음), `<plan>`의 파일명이 지금 plan의 파일명과 같을 때 그 N을 plan의 "시작한 task"로 기록한다.
- 현재 task를 고르는 우선순위:
  1. ledger의 `dispatched`(SDD) — 지금과 같음
  2. 시작한 task N이 아직 안 끝났으면 N
  3. 기존 규칙(무언가 끝났거나 체크됐으면 안 끝난 첫 task)
- 시작한 task는 plan을 다시 읽어도 유지되고, 다른 plan으로 바뀌면 지워진다.

## 빌더에게 맡긴 것 (내 판단)

- `task-brief`는 보지 않는다. 사용자가 고른 건 `task-start`이고, SDD는 이미 `dispatched`로 잡힌다.
- 아직 plan을 모르는 상태(plan을 Read/Write하지 않은 세션)에서 `task-start`만으로 plan을 새로 잡지는 않는다. 파일명이 지금 plan과 맞을 때만 반영한다.
- 기록 위치는 `Plan` 타입에 선택 필드 하나(`started?: string`)를 둔다.
