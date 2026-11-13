# Codex 클라우드 환경 설정

GitHub에서 `@codex`로 부르는 Codex는 ChatGPT의 Codex 설정(https://chatgpt.com/codex/settings)에 있는 이 저장소의 클라우드 환경에서 실행된다. 이 설정은 저장소 파일로 바꿀 수 없으므로, 바꿀 때마다 이 문서를 고친다.

Codex의 역할은 [에이전트 작업 규칙의 역할 절](../AGENTS.md#역할)에 있다. Codex는 계획, 리뷰, 질문 답변만 하고 코드를 바꾸지 않는다.

## 설정 스크립트

환경의 설정 스크립트(setup script)는 작업 전에 한 번 실행된다. 이 단계에서는 인터넷을 쓸 수 있다.

```shell
npm ci
npx playwright install --with-deps chromium
npm run build
```

Playwright Chromium이 있어야 Codex가 리뷰할 때 `npm run test:e2e`를 돌려 볼 수 있다.

## 인터넷 접근

작업 중(agent) 인터넷 접근은 기본으로 꺼져 있다. Claude의 질문에 공개 자료로 답할 수 있도록 아래 도메인만 허용한다. HTTP 메서드는 읽기(GET, HEAD, OPTIONS)만 허용한다.

| 도메인 | 쓰는 곳 |
|---|---|
| `github.com`, `raw.githubusercontent.com`, `api.github.com` | 원본 KLAS Helper 코드(`kw-service/klas-helper-extension`), 이 저장소의 이슈와 실행 기록 |
| `wxt.dev` | WXT 문서 |
| `developer.chrome.com` | Chrome 확장 API 문서 |
| `developer.mozilla.org` | WebExtensions API, 웹 표준 문서 |
| `playwright.dev` | E2E 테스트 문서 |

`klas.kw.ac.kr`는 허용하지 않는다. KLAS 화면은 로그인이 필요하고, Codex는 비밀번호와 학생 정보를 다루지 않는다(AGENTS.md "하지 않는 것"). KLAS 화면 정보가 필요하면 `need-user`로 사용자에게 요청한다.

## 코드 리뷰

- 코드 리뷰를 켜고 자동 리뷰(Automatic reviews)를 켠다. 메인테이너 계정이 연 PR에 자동으로 리뷰가 달린다.
- PR을 연 뒤의 push는 다시 리뷰하기도 하고 하지 않기도 한다(#135). `Codex review request` 워크플로가 모든 PR에서 push 뒤 3분 안에 리뷰가 시작되지 않으면 `@codex review`를 단다(`scripts/ai/request-review.sh`).
- 리뷰 기준은 AGENTS.md "Review guidelines"다.

## 확인할 것

- Codex 작업 결과로 PR 브랜치에 커밋이 올라오면 AI review loop가 `ai:needs-human`을 붙이고 멈춘다. 이런 일이 생기면 Codex 설정에서 그 작업이 어떻게 시작됐는지 확인한다.
- Codex 화면에서 "PR 만들기"를 누르면 Codex가 만든 코드가 저장소에 들어온다. 이 저장소에서는 쓰지 않는다.
