# Claude와 Codex 협업 규칙

이 문서는 사람이 읽는 전체 흐름이다. 누가 무엇을 하고, 어디서 멈추고, 언제 머지할 수 있는지를 적는다. Claude와 Codex가 메시지를 쓰는 방법과 리뷰 기준은 [AGENTS.md](../AGENTS.md)에 있고, 이 문서는 그 절을 가리키기만 한다.

기능 하나에 이슈 하나, PR 하나를 둔다. 기본은 GitHub에서 도는 자동 흐름이고, 자동 흐름을 쓸 수 없을 때는 맨 아래 "예비 절차"로 진행한다.

## 역할

| 누구 | 하는 일 | 하지 않는 일 |
|---|---|---|
| 사용자(메인테이너 `jundragon7419`) | 기능을 설명하고 계획을 승인한다. Codex가 답할 수 없는 정보(로그인한 KLAS 화면, DOM 발췌)를 준다. 결과를 확인하고 바꿀 점을 `@codex`로 요청한다. 머지한다. | AI 사이의 메시지를 옮기지 않는다. CI를 승인하거나 리뷰를 부르지 않는다. |
| Codex | 이슈(계획)를 쓰고, PR을 리뷰하고, Claude의 질문에 답하고, 수정 요청을 계획 개정(`change`)으로 바꾼다. | 코드를 바꾸지 않고 브랜치, 커밋, PR을 만들지 않는다. |
| Claude | 계획대로 구현하고, 리뷰 지적과 수정 요청을 반영하고, 막히면 Codex에게 묻는다. | 계획을 바꾸지 않고, 사용자에게 직접 요청하지 않는다. 검토 반영은 push하지 않는다. |
| GitHub Actions | 메시지를 확인해 다음 차례를 부르고, 라벨과 머지 게이트를 관리하고, 검토 반영을 검사해 push한다. | 판단할 수 없는 일은 사용자에게 넘긴다. 머지하지 않는다. |

| 워크플로 | 맡은 일 |
|---|---|
| `AI implement` | 승인된 이슈에서 Claude 구현을 실행하고 메인테이너 계정으로 PR을 연다 |
| `AI review loop` | Codex 리뷰와 CI 결과를 보고 Claude 검토 반영, `change` 실행, `ai:ready` 판정을 한다 |
| `AI relay` | Claude 질문을 Codex에게 넘기고, Codex 답에 따라 Claude를 다시 부르거나 사용자에게 알린다 |
| `Merge gate` | PR head 커밋에 머지 게이트 상태 `ai-gate`를 남긴다 |
| `CI` | `check`(검사, 빌드)와 `e2e`(가짜 KLAS 화면 E2E, 스크린샷)를 돌린다 |
| `Codex review request` | PR에 push한 뒤 3분 안에 Codex 리뷰가 시작되지 않으면 `@codex review`를 단다 |
| `Firefox label` | PR 본문의 "릴리스 전 Firefox 확인 필요" 체크에 맞춰 `firefox-check` 라벨을 붙인다 |

## 흐름

```text
계획 → 구현 → 리뷰 ⇄ 검토 반영 → ai:ready → (수정 요청 → 검토 반영) → 머지
         ↓ 막힘            ↓ 막힘
         질문(Codex 답 → 다시 시작, 답할 수 없으면 사용자)
```

### 1. 계획

1. 사용자가 Codex에게 기능을 설명한다. Codex가 "작업 (메인테이너)" 양식으로 `[작업] ...` 이슈를 만든다.
2. 영역에 "content script (KLAS 화면)"이 있으면 "대상 화면과 DOM 발췌" 칸이 채워져 있어야 한다. 발췌를 모으는 방법은 [tests/fixtures/klas/README.md "화면 DOM 발췌"](../tests/fixtures/klas/README.md#화면-dom-발췌)에 있다.
3. 사용자가 승인하면 구현이 시작된다. 둘 중 하나다.
   - 사용자가 이슈에 `@claude`로 시작하는 댓글을 단다. 덧붙인 내용은 구현 지시가 된다.
   - 사용자가 Codex 대화에서 승인하면 Codex가 사용자 계정으로 `start` 메시지를 단다(AGENTS.md "Codex의 구현 시작 댓글"). DOM 발췌가 비어 있으면 `start` 대신 `need-user`로 필요한 화면을 알린다.

### 2. 구현

`AI implement`에서 Claude가 `<종류>/<이슈 번호>-<설명>` 브랜치를 만들어 구현하고 검사를 통과시킨 뒤 push한다. PR은 다음 단계가 `MAINTAINER_PR_TOKEN`으로 메인테이너 계정에서 연다. Codex 자동 리뷰가 메인테이너가 연 PR에만 붙기 때문이다. PR에는 `ai:in-progress`가 붙는다.

Claude는 계획이 불분명하거나, 권한 추가, 공통 모듈 재작성, 실제 학생 데이터, `.github/workflows/` 수정, KLAS 화면 확인(DOM 발췌가 없음)이 필요하면 구현하지 않고 3번 질문으로 간다.

### 3. 질문

막히면 Codex가 먼저 답하고, Codex가 답할 수 없을 때만 사용자에게 넘어간다.

1. Claude가 `ask`(질문)나 `objection`(이견)을 남기고 `ai:needs-human`이 붙는다(AGENTS.md "막혔을 때 (Claude)").
2. 워크플로가 사용자 계정으로 `@codex` 요청(`<!-- ai-relay:... -->`)을 달아 그 메시지를 넘긴다(`scripts/ai/request-codex.sh`). 다음이면 Codex를 거치지 않고 사용자를 바로 부른다: Claude 메시지가 없거나 형식이 틀림, 최신 메시지에 이미 답이 있음, 이슈 하나(그 이슈를 닫는 PR 포함)에서 `ask`가 2회를 넘음, 같은 질문이 반복됨.
3. Codex가 `answer`나 `need-user`로 답한다(AGENTS.md "질문 답변 (Codex)"). Codex는 저장소, 공개 문서, 검색으로 답할 수 있다. 로그인이 필요한 KLAS 화면은 확인하지 않는다.
4. `AI relay`가 답을 분류한다(`scripts/ai/relay.js`).
   - `answer`, `재시작: 예`: Claude를 다시 부른다. 이슈는 `AI implement`, PR은 `AI review loop`가 근거를 다시 확인한 뒤 이어 간다.
   - `need-user`, `재시작: 아니오`, 형식 오류, 30분 안에 답이 없음: 사용자를 부른다.
5. 사용자는 필요한 정보를 `@codex`로 시작하는 댓글로 준다. Codex가 그 정보로 처음 질문에 `answer`를 다시 달면 4번으로 이어진다.

멈춘 뒤에는 멈춘 이유를 풀 새 정보(Codex 답, DOM 발췌, 확인 결과, 계획 개정)가 생겼을 때만 다시 시작한다(AGENTS.md "멈춘 이슈를 다시 시작할 때"). 사용자가 직접 다시 시작하려면 이슈는 `@claude` 댓글, PR은 `ai:needs-human` 라벨 제거로 한다.

### 4. 리뷰와 검토 반영

1. Codex가 PR의 현재 커밋을 리뷰한다. 기준은 AGENTS.md "Review guidelines"다. PR을 열 때는 Codex가 스스로 리뷰한다. push한 커밋은 스스로 리뷰하기도 하고 하지 않기도 하므로(#135), `Codex review request` 워크플로가 push 뒤 3분 안에 리뷰가 시작되지 않으면 메인테이너 계정으로 `@codex review`를 단다(`scripts/ai/request-review.sh`). 사람이 연 PR도 같고, 같은 커밋에는 한 번만 단다.
2. `AI review loop`가 Codex 결과와 CI(`check`, `e2e`)를 본다.
   - 현재 커밋에 Codex 지적이 있거나 CI가 실패하면 Claude가 고쳐서 커밋하고 `report`를 남긴다(AGENTS.md "수정을 마쳤을 때 (Claude)"). 회차마다 `ai:round-N`이 붙고 3회까지 한다.
   - Claude는 push하지 않는다. `push-fix`가 커밋을 검사한 뒤 메인테이너 토큰으로 push한다(`scripts/ai/push-fix.sh`). `GITHUB_TOKEN`으로 push하면 이어지는 CI가 승인 대기에 걸리기 때문이다.
3. 현재 커밋의 Codex 리뷰가 지적 없이 끝나고 CI가 성공하면 `ai:ready`로 바꾸고 사용자를 부른다.

### 5. 수정 요청

`ai:ready`인 결과가 마음에 들지 않으면 사용자가 PR에 `@codex`로 바꿀 점을 적는다. 이후는 사용자 중계 없이 이어진다.

1. Codex가 그 PR에 `change`(바뀐 완료 조건 전후, 이유, 바꿀 항목)를 단다(AGENTS.md "PR 수정 요청 (Codex)").
2. `AI review loop`가 `change`를 확인한다(`scripts/ai/change.js`). Codex나 메인테이너가 아닌 계정의 `change`는 무시하고, 근거 사용자 댓글이 없거나 rev가 최신이 아니거나 형식이 틀리면 오류와 함께 사용자를 부른다. PR당 3회를 넘으면 멈춘다.
3. 실행하면 `ai:ready`와 회차 라벨을 지우고 `ai:in-progress`를 붙인다. 머지 게이트가 대기로 돌아가 수정 중에는 머지할 수 없다. 이슈에는 개정 기록 댓글을 남긴다.
4. Claude가 최신 계획(이슈 본문과 모든 개정)에 맞춰 고치고 `report`를 남긴다. 이후는 4번과 같고 회차는 처음부터 센다.

### 6. 완료

1. 사용자가 PR 본문의 "KLAS에서 직접 확인할 항목"을 확인한다. 화면 결과는 CI 실행의 `e2e-screenshots` artifact에서도 볼 수 있다.
2. `ai-gate`가 성공이면 PR 본문의 Squash 커밋 메시지로 머지한다.
3. 머지한 이슈는 [AI-METRICS.md](AI-METRICS.md)에 한 행을 기록한다.
4. Firefox에서 다르게 동작할 수 있는 변경은 PR에 `firefox-check` 라벨이 붙고, 릴리스 PR에서 Firefox로 확인한다([CONTRIBUTING.md "배포"](../CONTRIBUTING.md#배포)).

## 라벨과 머지 게이트

| 라벨 | 뜻 |
|---|---|
| `ai:in-progress` | 자동 흐름 진행 중. 머지 게이트가 대기 |
| `ai:round-1` ~ `ai:round-3` | 검토 반영 회차. `change`를 실행하면 처음부터 센다 |
| `ai:ready` | 현재 커밋이 Codex 리뷰와 CI를 통과함. 사용자 확인 대기 |
| `ai:needs-human` | 자동 흐름이 멈춤. 사용자 판단 필요. 머지 게이트가 실패 |
| `firefox-check` | 릴리스 전 Firefox에서 확인할 PR |

`develop`으로 가는 모든 PR(자동 흐름과 사람이 연 PR 모두)은 head 커밋의 commit status `ai-gate`가 성공이어야 머지할 수 있다. ruleset "Protect develop"이 CI `check`와 함께 필수 검사로 요구한다. CI `e2e`는 ruleset에 따로 넣지 않고 `ai-gate`가 성공 조건으로 본다. 판단은 `scripts/ai/merge-gate.js`, 기록은 `Merge gate` 워크플로가 한다.

| 상태 | 조건 |
|---|---|
| 성공 | 현재 커밋의 Codex 리뷰가 끝났고, 현재 커밋에서 단 P0/P1 지적이 없고, CI `check`와 `e2e`의 최신 실행이 각각 성공했고, `ai:in-progress`와 `ai:needs-human`이 없음 |
| 대기 | CI 진행 중, 현재 커밋의 Codex 리뷰가 아직 없음, 자동 흐름 진행 중 |
| 실패 | CI 실패, 현재 커밋에 P0/P1 지적이 있음, Codex가 현재 커밋에 리뷰 대신 코드 수정 작업을 남기고 그 뒤 다시 리뷰받지 않음, 자동 흐름이 멈춤 |

- 리뷰 완료는 Codex 요약 댓글의 상태 표시(`codex-review-state`), 현재 커밋에 대한 리뷰, `@codex review` 응답, 현재 커밋의 파일을 가리키는 작업 결과 댓글(`View task →`) 중 리뷰 결과인 것으로 인정한다. 판단은 `scripts/ai/review-decision.js`의 `classifyCodexTask`, `codexResults`가 하고, 머지 게이트와 `AI review loop`가 같이 쓴다.
  - 리뷰 결과: "검토 결과", "Codex Review", "문제를 발견하지 못했습니다" 같은 문구나 `[P0]`~`[P3]` 표시가 있다. `[P0]`, `[P1]`을 머지를 막는 지적으로 센다. 지적이 있으면 자동 흐름이 고친다.
  - 코드 수정 결과: Codex가 리뷰 대신 코드를 고쳐 커밋했다는 요약("커밋했습니다", "Committed the changes", `make_pr`)이다. 리뷰로 세지 않는다. Codex가 고칠 문제를 찾았다는 뜻이므로 게이트는 실패하고, 자동 흐름은 `ai:needs-human`으로 멈추고 사용자를 부른다. 그 뒤 현재 커밋을 `@codex review`로 다시 리뷰받거나 새 커밋을 올리면 풀린다(PR #135).
- Codex는 리뷰가 끝날 때마다 새 댓글을 달지 않는다. 요약 댓글의 표를 고치고, 지적이 없으면 PR 본문에 👍를 단다. 리뷰가 끝났는지는 `ai-gate` 설명으로 보면 된다.
- P2 이하 지적은 머지를 막지 않는다. 자동 흐름은 P2도 고친 뒤 `ai:ready`가 된다.
- 이전 커밋에서 단 지적은 GitHub가 새 커밋 위치로 옮겨 보여 줘도 세지 않는다. Resolve는 화면 정리일 뿐 게이트에 영향이 없다.
- 새 커밋에는 상태가 없으므로 게이트가 다시 판단하기 전까지 머지가 막힌다.
- 검사 목록에 `gate`가 취소(cancelled)로 보이는 것은 정상이다. 같은 PR에서 새 판단이 시작되면 이전 판단을 취소한다. 머지 가능 여부는 `ai-gate`로 본다.
- 저장소 관리자는 ruleset 우회로 머지할 수 있지만 쓰지 않는 것을 원칙으로 한다.

## 멈춤 조건

다음이면 `ai:needs-human`을 붙이고 멈춘다. 3번 질문 흐름으로 Codex가 먼저 정리하고, 표의 "바로 사용자"는 Codex를 거치지 않는다.

| 멈춤 | 어디서 | 누가 정리 |
|---|---|---|
| Claude `ask`나 `objection`(계획 불분명, 권한, 공통 모듈, 실제 데이터, 워크플로 수정, DOM 없음, 지적에 이견) | 이슈 또는 PR | Codex |
| 구현이나 검토 반영 단계 실패 | 이슈 또는 PR | Codex |
| 검토 반영 3회 뒤에도 지적이 남음 | PR | Codex |
| 같은 이슈에서 `ask` 3회째, 같은 질문 반복, 답을 받고도 새 메시지 없이 멈춤 | 이슈 또는 PR | 바로 사용자 |
| `change` 3회 초과 | PR | 바로 사용자 |
| 마지막 커밋 뒤 3시간 동안 Codex 리뷰 없음 | PR | 바로 사용자 |
| Codex가 리뷰 대신 코드 수정 작업 결과를 남김 | PR | 바로 사용자 |
| PR 브랜치에 Codex가 커밋을 올림 | PR | 바로 사용자 |

## 안전 장치

- 구현은 메인테이너(`jundragon7419`)가 단 `@claude` 댓글이나 `start` 메시지로만 시작한다. 같은 이슈에 열린 PR이 있으면 새로 시작하지 않는다.
- 검토 반영과 `change`는 같은 저장소 브랜치의 자동 흐름 PR에서만 한다. 통과 판정은 현재 head 커밋 SHA에 묶인 Codex 결과와 CI 결과만 쓰고, 새 커밋이 올라오면 `ai:ready`는 지워진다.
- 판단에 쓰는 표시는 정해진 계정이 단 것만 인정한다. 공개 저장소라 누구나 댓글을 달 수 있기 때문이다.

  | 표시 | 인정하는 계정 |
  |---|---|
  | ai-msg 메시지 | AGENTS.md "AI 메시지 형식"의 보내는 쪽 |
  | `<!-- ai-handled:... -->` 처리 표시 | `claude[bot]` |
  | `codex-review-state` 리뷰 상태 | `chatgpt-codex-connector[bot]` |
  | `<!-- ai-relay:... -->` Codex 요청 | 메인테이너 |
  | `<!-- ai-pinged:... -->` 알림 | `github-actions[bot]` |

- 자동 흐름의 Claude는 `.github/workflows/` 파일을 push할 수 없다. `push-fix`는 브랜치 이름 규칙, 작업 중 원격 브랜치가 바뀌지 않음, fast-forward, 워크플로 변경 없음을 확인한 커밋만 push한다. 워크플로 변경은 예비 절차로 한다.
- `MAINTAINER_PR_TOKEN`은 이 저장소만 대상으로 한 fine-grained token이다. 권한은 Contents, Pull requests, Issues 읽기/쓰기이고 Workflows 권한은 없다. `develop`과 `main`은 ruleset이 직접 push를 막으므로 이 토큰으로 push할 수 있는 곳은 작업 브랜치뿐이다. PR 열기, 검토 반영 push, Codex 재리뷰 요청, Codex 정리 요청에만 쓴다. 이 토큰으로 댓글을 달지 못하면 Actions 토큰으로 사용자에게 바로 알린다.
- 이 토큰을 쓰는 작업과 판단 코드(`scripts/ai/`)는 기본 브랜치를 새로 체크아웃한 작업에서 실행한다. 이슈나 PR 내용에 심어진 지시로 Claude가 파일을 바꿔도 토큰과 판단 코드에 닿지 못하게 하기 위함이다.
- 머지는 사용자만 한다.

## 예비 절차

자동 흐름을 쓸 수 없을 때(`.github/workflows/` 수정, 자동 흐름 고장, 사용자가 직접 맡긴 작업) 사용자가 Claude나 Codex와 대화하며 진행한다. 역할, 브랜치와 PR 규칙, 머지 게이트는 같다.

1. 사용자가 구현 담당을 정한다. 기본은 Claude 구현, Codex 리뷰다.
2. 구현 담당은 원격 `develop` 최신 커밋에서 작업 브랜치를 만들고, 검사를 모두 통과시킨 뒤 PR을 연다. 다른 사람이 남긴 미커밋 변경은 건드리지 않는다.
3. 리뷰는 PR의 Codex 자동 리뷰를 쓴다. 지적은 구현 담당이 고쳐 같은 브랜치에 push한다. 새 커밋의 재리뷰는 `Codex review request` 워크플로가 챙긴다.
4. 두 도구의 판단이 갈리거나 완료 조건을 바꿔야 하면 사용자가 정한다.
5. `ai-gate`가 성공이면 사용자가 머지한다.

대화 사이에 작업을 넘길 때는 아래만 전달한다. PR은 주소와 SHA로 가리키고 파일 전체를 붙여 넣지 않는다.

```text
이슈 #번호 / PR 주소 / head SHA
완료 조건별 결과 또는 남은 지적
실행한 검사와 결과 / 직접 확인하지 못한 항목
```
