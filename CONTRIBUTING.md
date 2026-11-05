# 기여 안내

관심 가져 주셔서 감사합니다. 코드 말고도 오타 수정, 문서 보완, 버그 제보 모두 기여입니다.

## 개발 환경

- Node.js: `.nvmrc`에 적힌 버전을 씁니다. `nvm use` 또는 `fnm use`로 맞춰 주세요.
- 에디터: Visual Studio Code를 권장합니다.
- 브라우저: Chrome 계열(Chrome, Edge) 최신 버전에서 먼저 확인합니다. Firefox 지원은 별도로 확인합니다.

### 처음 설치

```shell
npm install
```

설치가 끝나면 `wxt prepare`가 자동으로 실행되어 `.wxt/` 폴더에 타입 정보가 만들어집니다. 이 폴더는 저장소에 올리지 않습니다.

### 개발 서버

```shell
npm run dev          # Chrome
npm run dev:firefox  # Firefox
```

확장이 로드된 브라우저 창이 새로 열리고, 코드를 저장하면 확장이 자동으로 다시 로드됩니다. 이 창은 평소에 쓰는 브라우저와 다른 프로필이라, KLAS에는 이 창에서 따로 로그인해야 합니다.

`npm run dev`는 Chrome을 찾아서 창을 띄웁니다. Chrome이 설치되어 있지 않으면 창이 열리지 않습니다. 이때는 `npm run dev`를 켜 둔 채로, 아래 "직접 로드하기"의 방법으로 `.output/chrome-mv3-dev/` 폴더를 Edge에 로드하면 됩니다. 코드를 저장하면 이 폴더가 다시 빌드되고 확장도 자동으로 다시 로드됩니다. 터미널에 나오는 `http://localhost:3000`은 개발 서버 주소라서 브라우저에서 열어도 404가 나는 것이 정상입니다.

### 직접 로드하기

1. `npm run build`로 빌드합니다. 결과는 `.output/chrome-mv3/`에 생깁니다. `npm run dev`를 켜 둔 상태라면 `.output/chrome-mv3-dev/`를 씁니다.
2. 확장 관리 페이지를 열고 개발자 모드를 켭니다.
   - Chrome: 주소창에 `chrome://extensions`, 오른쪽 위 **개발자 모드**
   - Edge: 주소창에 `edge://extensions`, 왼쪽 **개발자 모드**
3. Chrome은 **압축해제된 확장 프로그램을 로드합니다**, Edge는 **압축 풀린 항목 로드**를 누르고 1번의 폴더를 고릅니다.

### 명령 목록

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | Chrome 개발 서버 |
| `npm run dev:firefox` | Firefox 개발 서버 |
| `npm run build` | Chrome용 빌드 (`.output/chrome-mv3/`) |
| `npm run build:firefox` | Firefox용 빌드 (`.output/firefox-mv3/`) |
| `npm run zip` | Chrome 웹스토어 제출용 zip |
| `npm run zip:firefox` | Firefox 부가 기능 사이트 제출용 zip |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` | ESLint 검사 |
| `npm run format` | Prettier로 코드 정리 |
| `npm run format:check` | 코드 형식 검사 (고치지 않음) |
| `npm test` | 테스트 한 번 실행 |
| `npm run test:watch` | 파일이 바뀔 때마다 테스트 다시 실행 |

### PR을 열기 전에

아래 명령이 모두 통과해야 합니다. CI도 같은 순서로 검사합니다.

```shell
npm run lint
npm run format:check
npm test
npm run typecheck
npm run build
npm run build:firefox
```

형식 검사가 실패하면 `npm run format`으로 고친 뒤 다시 커밋하면 됩니다. Prettier는 코드와 설정 파일에만 적용하고 마크다운 문서에는 적용하지 않습니다.

VS Code를 쓰면 저장소를 열 때 ESLint와 Prettier 확장 설치를 권하는 알림이 뜹니다. 설치해 두면 저장할 때 자동으로 형식이 맞춰집니다.

## 작업 순서

1. 작업할 내용을 이슈로 먼저 올리거나, 기존 이슈에 댓글로 맡겠다고 알려 주세요.
2. 저장소를 fork하고 `develop`에서 브랜치를 만듭니다. 브랜치 이름은 아래 [브랜치](#브랜치) 절을 따릅니다.
3. PR은 `develop`으로 보냅니다. PR 하나에는 기능 하나 또는 수정 하나만 담습니다.
4. PR을 열기 전에 [PR을 열기 전에](#pr을-열기-전에)의 명령을 모두 통과시킵니다.
5. Chrome 계열 브라우저(Chrome, Edge)에서 확장을 직접 로드해서 동작을 확인하고, 화면이 바뀌었다면 스크린샷을 PR에 붙입니다.

`main`과 `develop`에 직접 push하지 않습니다.

## 브랜치

| 브랜치 | 용도 |
|---|---|
| `main` | 배포된 버전만 있는 브랜치입니다. 배포할 때 `develop`을 `main`으로 합칩니다. |
| `develop` | 개발 브랜치입니다. 모든 PR은 여기로 보냅니다. |
| 작업 브랜치 | `develop`에서 만들고, 합친 뒤 지웁니다. |

작업 브랜치 이름은 `<종류>/<이슈 번호>-<짧은 설명>` 형식입니다.

| 종류 | 쓰는 경우 | 예 |
|---|---|---|
| `feat/` | 새 기능 | `feat/10-deadline-badge` |
| `fix/` | 버그 수정 | `fix/23-session-detect` |
| `refactor/` | 동작은 그대로 두고 코드 정리 | `refactor/31-api-client` |
| `docs/` | 문서 | `docs/4-architecture-update` |
| `chore/` | 설정, 도구, CI | `chore/1-develop-branch` |

PR은 메인테이너가 "Squash and merge"로 합칩니다. PR 제목이 `develop`에 남는 커밋 메시지가 되므로, PR 제목도 [커밋 메시지](#커밋-메시지) 규칙을 따라 주세요.

## 커밋 메시지

무엇을 바꿨는지 한 문장으로 씁니다. 한국어로 써도 되고 영어로 써도 됩니다.

제목 앞에 이모지나 `feat:` 같은 접두어를 붙이지 않습니다. 작업의 종류는 이슈 라벨로 구분합니다.

예: `툴바 아이콘에 미제출 개수 배지 추가`, `Add unsubmitted count badge to toolbar icon`

## 기능 범위

받는 기능: KLAS를 보고 있을 때 더 편하게 쓰고, 놓치는 마감을 줄이는 기능

기존 KLAS 화면에 버튼, 메뉴, 문구를 넣거나 원래 요소를 바꾸는 기능은 다음을 지켜 주세요.

- 넣거나 바꾼 요소에 확장 표시 공통 부품을 붙입니다. 사용자가 KLAS 원래 기능과 확장 기능을 구분할 수 있어야 합니다.
- KLAS 원래 요소를 말없이 지우지 않습니다.
- 기능마다 독립된 모듈로 만들고, 넣을 위치를 찾지 못하면 그 기능만 조용히 꺼지게 합니다.
- KLAS가 열려 있지 않을 때 KLAS에 요청하는 기능은 받지 않습니다.

받지 않는 기능:

- 학습 인증 우회, 출석이나 진도를 조작하는 기능
- 강의 영상을 내려받거나 다른 곳으로 퍼 나르는 기능
- 사용자 대신 과제를 제출하거나 KLAS 데이터를 바꾸는 기능
- KLAS 데이터를 외부 서버로 보내는 기능

이런 기능은 학교 규정과 Chrome 웹스토어 정책에 걸릴 수 있고, 확장 전체가 스토어에서 내려가는 원인이 될 수 있습니다.

## KLAS 데이터 다루기

- 테스트 fixture에 실제 학생 데이터를 넣지 마세요. 학번, 이름, `userId` 같은 필드는 가짜 값으로 바꿉니다.
- 이슈나 PR에 스크린샷을 올릴 때 학번, 이름, 성적은 가려 주세요.
- KLAS 내부 API는 조회(목록) 요청만 씁니다. 새 API를 쓰게 되면 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)의 API 목록에 추가해 주세요.
- 새 권한을 manifest에 추가하는 PR은 그 권한이 왜 필요한지 설명해 주세요.

## 기존 KLAS Helper 코드를 가져올 때

원래 KLAS Helper도 MIT 라이선스입니다. 그 코드를 가져오면 [LICENSE](LICENSE)에 원래 저작권 표시(`Copyright (c) 2020-2023 nbsp1221, mirusu400`)를 추가하고, PR 설명에 어느 파일에서 가져왔는지 적어 주세요.

## 라이선스

기여한 코드는 이 저장소의 [MIT 라이선스](LICENSE)를 따르는 것에 동의한 것으로 봅니다.
