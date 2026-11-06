# 구조와 결정 사항

## 목표

KLAS를 보고 있을 때 돕는 확장을 만든다. KLAS 화면 오른쪽의 탭에서 마감 일정 같은 정보를 모아 보여 주고, 기존 KLAS 화면에는 그 페이지에서만 의미 있는 기능을 더한다. KLAS가 열려 있지 않을 때는 KLAS에 요청하지 않는다.

## 기존 KLAS Helper와 다른 점

기존 확장은 `app.js`를 `<script>` 태그로 KLAS 페이지(페이지 world)에 넣고, KLAS의 axios와 Vue 인스턴스(`appModule`)를 빌려 써서 화면을 바꾼다. 이 방식은 KLAS가 프론트엔드를 조금만 바꿔도 여러 기능이 같이 깨진다.

이 프로젝트는 KLAS 내부 API를 확장이 직접 호출하고, 정보를 모아 보는 화면은 KLAS 레이아웃과 분리된 탭에 그린다. 기존 KLAS 화면에 넣는 기능은 기능마다 독립된 모듈로 만들어, KLAS가 바뀌어도 해당 기능 하나만 멈추게 한다.

## 구성

```
KLAS 페이지 (content script)                 background
  ├─ KLAS 탭: 오른쪽 가운데 < 버튼으로 여닫음     ├─ 캐시: chrome.storage
  │    마감 일정 등 (Shadow DOM, Preact)          ├─ 탭 사이 조정: 여러 KLAS 탭 중 한 곳만 조회
  ├─ KLAS API 조회 ───────── 저장 ──────────▶   └─ 세션 연장 타이머: chrome.alarms 10분
  ├─ 세션 연장 요청 ◀──── KLAS 탭이 있을 때만 ──────┘
  └─ 기존 화면 기능 모듈 (페이지별, 기능마다 독립)

(선택) MAIN world 스크립트: KLAS 동작을 꼭 바꿔야 할 때만, 로직 없이
```

### 원칙

1. KLAS가 열려 있지 않으면 KLAS에 요청하지 않는다. 조회와 세션 연장은 모두 KLAS 탭이 있을 때만 한다.
2. KLAS 요청은 KLAS 탭의 content script가 보낸다. KLAS와 같은 출처에서 요청하므로 브라우저의 서드파티 쿠키 설정이나 추적 방지의 영향을 받지 않는다.
3. background는 캐시, 탭 사이 조정, 세션 연장 타이머를 맡는다. 탭이 여러 개여도 같은 조회가 겹치지 않게 하고, 최근 결과가 있으면 다시 요청하지 않는다.
4. 세션은 KLAS 탭이 열려 있는 동안 10분마다 연장하고, 설정으로 끌 수 있다. content script 안의 타이머는 뒤에 숨은 탭에서 느려지므로 background의 alarms가 시점을 정한다.
5. service worker는 쉬고 있으면 종료된다. 상태는 변수가 아니라 `chrome.storage`에 둔다.
6. 화면은 캐시를 먼저 보여 주고 뒤에서 새로 고친다. 언제 기준의 정보인지 표시한다.
7. 기존 KLAS 화면에 넣는 기능은 기능마다 독립된 모듈로 만들고, 넣을 위치를 찾지 못하면 그 기능만 꺼진다.
8. 기존 KLAS 화면에 넣거나 바꾼 요소에는 확장 표시를 붙이고, 원래 요소를 말없이 지우지 않는다.
9. MAIN world 스크립트는 최소한으로 둔다. 필요한 정보는 `CustomEvent`로 content script와 주고받는다.
10. 권한은 기능에 필요한 만큼만 요청한다.

## 화면

### 방식: KLAS 안의 탭

2026-11-06에 결정했다. 이슈 #7에서 정한 "툴바 배지 + 브라우저 사이드 패널"을 대체한다.

- **열고 닫기**: KLAS 화면 오른쪽 가운데에 살짝 튀어나온 `<` 버튼을 누르면 탭이 오른쪽에서 밀려 나오고, 다시 누르면 들어간다.
- **그리는 방법**: content script가 `body`에 고정 위치로 붙이고 Shadow DOM 안에 그린다. KLAS 레이아웃이나 CSS가 바뀌어도 영향을 거의 받지 않는다.
- **첫 목표**: 탭에 마감 일정만 보여 준다. 다른 기능은 v0.1.0을 써 본 뒤 정한다.
- **브라우저 사이드 패널을 쓰지 않는 이유**
  - 툴바 아이콘을 눌러야 열려서, 확장 아이콘을 숨겨 둔 사용자는 있는 줄 모를 수 있다. KLAS 안의 탭은 KLAS 화면에 항상 보인다.
  - Chrome과 Edge의 `sidePanel`, Firefox의 `sidebar_action`을 따로 처리할 필요 없이 세 브라우저가 같은 코드를 쓴다. `sidePanel` 권한도 필요 없다.
  - 조회와 화면이 같은 content script 안에 있어서 메시지를 주고받을 필요가 없다.
- **단점**: 탭을 열면 KLAS 화면 일부를 가린다. 탭 폭과 좁은 창에서의 동작은 디자인에서 정한다.

### 기능 배치

- **KLAS 탭에 넣을 것**: 어느 KLAS 페이지에서든 따로 떼어 볼 수 있는 정보 (마감 일정, 성적 평점, 석차, 어학 성적, 강의 새 글, 바로가기, 설정)
- **기존 KLAS 화면에 넣을 것**: 그 페이지에서만 의미 있는 기능 (시간표 시간 표시, 강의 숨기기, 강의계획서 검색 편의 등)
- 어떤 기능을 v1.0에 넣을지는 `docs/ROADMAP.md`를 따른다.

### 확장 표시

- 기존 KLAS 화면에 넣거나 바꾼 메뉴, 버튼, 문구에는 확장 기능이라는 표시를 붙인다. 사용자가 KLAS 원래 기능과 확장 기능을 구분할 수 있게 하고, 문제가 생겼을 때 어디에 알려야 하는지 알 수 있게 하기 위해서다.
- 표시 모양(예: `(+)`)은 디자인에서 정하고, 하나의 공통 부품으로 만든다.
- 화면 낭독기가 "KLAS Helper+ 기능"이라고 읽도록 설명을 붙인다.
- 시간표 칸처럼 반복되는 요소는 칸마다 붙이지 않고 영역 제목에 한 번만 붙인다.
- KLAS 탭 자체는 확장 화면이라 따로 표시하지 않는다.

### UI 프레임워크: Preact

이슈 #7에서 정했다. 사이드 패널 대신 KLAS 탭의 Shadow DOM 안에 그리는 것으로 바뀌었지만 결정은 그대로다.

시안 A의 마감 목록(필터 버튼 5개, 항목 6개)을 같은 내용으로 네 번 만들어 운영 빌드한 결과:

| 방식 | JS 크기 | gzip 후 | 추가 설정 | 타입 검사, lint |
|---|---|---|---|---|
| 프레임워크 없음 | 2.4 KB | 1.1 KB | 없음 | 그대로 통과 |
| Preact 11 | 15 KB | 6.4 KB | Vite 플러그인, tsconfig 2줄 | 그대로 통과 |
| Svelte 5 | 35 KB | 13.8 KB | WXT 모듈 | `.svelte`는 `tsc`, ESLint로 검사되지 않아 `svelte-check`와 ESLint 플러그인이 더 필요 |
| React 19 | 221 KB | 68 KB | WXT 모듈, tsconfig 1줄 | 그대로 통과 |

Preact를 고른 이유:

- React와 문법이 같아서 React를 아는 기여자가 바로 참여할 수 있다.
- 크기가 React의 10분의 1이다. content script는 KLAS 페이지를 열 때마다 로드되므로 가벼운 편이 낫다.
- 지금의 검사 체계(`tsc`, ESLint, Vitest)를 그대로 쓴다.
- 프레임워크 없이 만들면 같은 화면에서도 DOM을 직접 다루는 코드가 길어져서, 화면이 늘어날수록 읽기 어려워진다.

설정할 때 필요한 것: `@preact/preset-vite`를 `wxt.config.ts`의 Vite 플러그인에 추가하고, `tsconfig.json`에 `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`를 넣는다. hooks 규칙을 검사하려면 `eslint-plugin-react-hooks`를 함께 쓴다.

## 검증된 사실 (2026-11-05, Chrome, 테스트 확장으로 확인)

- KLAS의 axios나 Vue 없이 `fetch`만으로 아래 API를 조회할 수 있다. CSRF 토큰이나 별도 헤더는 필요 없다.
- 확장 페이지, background(service worker), content script(격리 world) 세 곳 모두에서 로그인 쿠키가 실리고 같은 결과가 나왔다.
- Firefox 159에서도 content script의 기본 `fetch`로 같은 결과가 나왔다. 로그인 쿠키가 실리고 JSON이 온다. 향상된 추적 방지를 "표준"과 "엄격"으로 둔 경우 모두 같았다. Chrome과 같은 코드를 쓴다. (2026-11-06, 임시 부가 기능으로 확인, #17)
  - Firefox 전용이던 `content.fetch`는 Firefox 159에 없다.
  - 페이지 world의 `fetch`(`window.wrappedJSObject.fetch`)도 동작한다. 기본 `fetch`가 막힐 때의 예비 수단이다.
  - 임시 부가 기능으로 올렸을 때 `klas.kw.ac.kr` 사이트 권한은 처음부터 허용되어 있었다.
- KLAS의 기본 세션 시간은 2시간(7200초)이다. 아무것도 하지 않으면 그 뒤에 로그아웃된다. 서버 값으로 확인했다. (2026-11-06, #16)
- 원래 KLAS Helper는 사이트를 다시 불러오거나(10분마다) KLAS의 세션 연장 함수를 호출해서(5분마다) 세션을 유지해 왔다. (kw-service/klas-helper-userscript PR #30, 이슈 #99, kw-service/klas-helper-extension PR #17)

## KLAS 내부 API

모두 `POST`, 본문은 JSON이다.

| 용도 | 경로 | 본문 |
|---|---|---|
| 학기별 수강 과목 | `/std/cmn/frame/YearhakgiAtnlcSbjectList.do` | `{}` |
| 온라인 강의 | `/std/lis/evltn/SelectOnlineCntntsStdList.do` | 과목 공통 본문 |
| 과제 | `/std/lis/evltn/TaskStdList.do` | 과목 공통 본문 |
| 팀 프로젝트 | `/std/lis/evltn/PrjctStdList.do` | 과목 공통 본문 |
| 퀴즈 | `/std/lis/evltn/AnytmQuizStdList.do` | 과목 공통 본문 |

과목 공통 본문: `{"selectSubj": <과목 value>, "selectYearhakgi": <학기 value>, "selectChangeYn": "Y"}`

수강 과목 응답 형태:

```json
[{ "value": "2026,2", "label": "2026년도 2학기", "subjList": [{ "value": "<과목 코드>", "label": "...", "name": "<과목명>" }] }]
```

### 주의할 점

- **본문은 반드시 JSON.** `Content-Type: application/json`으로 보낸다. form 형식(`x-www-form-urlencoded`)으로 보내면 HTTP 500이 난다.
- **세션이 끊겨도 HTTP 200이다.** 로그인 페이지 HTML이 리다이렉트로 온다. 성공 여부는 상태 코드가 아니라 `content-type`이 JSON인지로 판단한다.
- **잘못된 요청에도 빈 배열이 온다.** 과목 코드 필드를 잘못 넣어도 에러 없이 `[]`가 온다. 응답 스키마 검사와 테스트로 막는다.
- **과목 코드는 `subj`가 아니라 `value` 필드다.**

### 조회 코드

`utils/klas/api.ts`가 다섯 API를 부르고 `utils/klas/schema.ts`가 응답을 검사한다. 결과는 성공 또는 실패이고, 실패는 네 종류로 나눈다.

| 종류 | 뜻 | 판단 |
|---|---|---|
| `session` | 로그인이 끊김 | 응답 주소가 `/usr/cmn/login/` 아래 (로그인 페이지로 이동) |
| `network` | 요청 실패 | 요청 예외, 시간 초과(15초), HTTP 오류 |
| `not-json` | 알 수 없는 응답 | 로그인 페이지가 아니고 `content-type`이 JSON이 아니거나 JSON을 읽을 수 없음 |
| `schema` | KLAS 형식 바뀜 | JSON이지만 쓰는 필드가 없거나 형식이 다름 |

응답 검사는 확장이 쓰는 필드만 확인한다. 필드가 더해지는 것은 괜찮다. 온라인 강의 목록에는 강의(`evltnSe: "lesson"`)와 퀴즈(`"quiz"`)가 섞여 오고, 퀴즈 줄에는 `isonoff`, `prog`가 없다.

### 세션 (2026-11-06, Edge, #16)

KLAS 화면의 남은 시간 표시는 서버의 `GET /api/v1/session/info`에서 값을 받는다. 응답 예: `{"remainingTime": 7126, "sessionNotiSec": 6826, "logoutCountDownSec": 300}`. 남은 시간이 300초가 되면 화면에 연장 안내가 뜨고, 0이 되면 페이지가 `/usr/cmn/login/Logout.do`를 호출한다. 화면은 30초마다 `session/info`를 다시 읽어 서버 값과 10초 넘게 차이 나면 표시를 고친다.

요청마다 `session/info`의 `remainingTime`을 앞뒤로 읽어 비교했다.

| 요청 | 남은 시간 | 응답 |
|---|---|---|
| `GET /api/v1/session/info` | 그대로 줄어듦 (46초 뒤 46초 감소) | JSON |
| `POST /std/cmn/frame/YearhakgiAtnlcSbjectList.do` | 7200으로 되돌아감 | JSON |
| `GET /` | 7200으로 되돌아감 | `Frame.do`로 이동, HTML 약 82 KB |
| `GET /usr/cmn/login/UpdateSession.do` | 7200으로 되돌아감 | JSON `{}` (2 B) |

결정:

- 세션 연장에는 `GET /usr/cmn/login/UpdateSession.do`를 쓴다. KLAS 화면의 연장 버튼이 부르는 요청이고, 응답이 가장 작고, 정보를 읽거나 바꾸지 않는다.
- 세션 상태 확인에는 `GET /api/v1/session/info`를 쓴다. 세션을 연장하지 않으므로, 연장이 꺼져 있을 때도 남은 시간을 읽을 수 있다.
- 일반 API 조회도 세션을 연장한다. 조회 직후에는 따로 연장 요청을 보내지 않아도 된다.
- KLAS 페이지의 세션 연장 함수(`sessionExtensionReq1` 등)는 부르지 않고 요청을 직접 보낸다. 원래 KLAS Helper는 이 함수를 불렀는데, KLAS가 함수 이름을 바꾸자 페이지 스크립트를 뒤져 찾는 방식으로 대응해야 했다 (kw-service/klas-helper-extension PR #17).

### 날짜 형식

API마다 다르다. 확인한 형식:

| 예시 | 쓰이는 곳 | 해석 |
|---|---|---|
| `2026-12-01 18:00:59` | 과제 `expiredate` | 한국 시간 |
| `2026-11-13T14:59:59.000+00:00` | 팀 프로젝트 `expiredate` | UTC (한국 시간 23:59:59) |
| `2026-10-12 23:59` | 온라인 강의 `endDate`, 퀴즈 `edt` | 한국 시간 |
| `202610122359` | 온라인 강의, 퀴즈 `edate` | 한국 시간 |

`utils/date.ts`의 `parseKlasDate`가 네 형식을 epoch ms로 바꾼다. 시간대 표시가 없는 형식은 PC 시간대와 관계없이 한국 시간(UTC+9)으로 본다. `new Date(문자열)`로 해석하면 PC 시간대를 따라가서 해외에서는 마감이 최대 17시간 어긋나므로 쓰지 않는다. 형식이 다르거나 없는 날짜면 `null`을 돌려준다.

### 마감 판단 규칙 (기존 KLAS Helper `home.js`와 같음)

| 종류 | 대상 | 완료 조건 | 마감 |
|---|---|---|---|
| 온라인 강의 | `evltnSe === "lesson"` 이고 `isonoff !== "OFF"` | `prog === 100` | `endDate` 끝에 `:59` |
| 과제, 팀 프로젝트 | 전부 | `submityn === "Y"` | `expiredate`, 지났으면 `reexpiredate`(추가 제출 기한) |
| 퀴즈 | 전부 | `issubmit === "Y"` | `edt` |

## 아직 정하지 않은 것

- Firefox에서 서명된 부가 기능으로 정식 설치했을 때도 `klas.kw.ac.kr` 사이트 권한이 처음부터 허용되는지 (배포 때 확인)
- 학기 선택 규칙: 과목 목록의 첫 학기를 현재 학기로 볼 수 있는지 (방학, 수강 신청 기간 포함)
- KLAS 탭의 폭, 좁은 창에서의 동작, 확장 표시 모양 (디자인)
- v1.0 기능 범위 (v0.1.0을 써 본 뒤)
