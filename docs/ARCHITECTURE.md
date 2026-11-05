# 구조와 결정 사항

## 목표

KLAS 화면 구조에 최대한 의존하지 않으면서, KLAS를 열지 않아도 마감을 알려 주는 확장을 만든다.

## 기존 KLAS Helper와 다른 점

기존 확장은 `app.js`를 `<script>` 태그로 KLAS 페이지(페이지 world)에 넣고, KLAS의 axios와 Vue 인스턴스(`appModule`)를 빌려 써서 화면을 바꾼다. 이 방식은 KLAS가 프론트엔드를 조금만 바꿔도 깨진다.

이 프로젝트는 KLAS 내부 API를 확장이 직접 호출하고, 화면은 KLAS와 분리해서 그린다.

## 구성

```
background (service worker)
  ├─ KLAS API 계층: 모든 KLAS 요청은 여기서만 보낸다
  ├─ 캐시: chrome.storage
  └─ 주기 조회와 알림: chrome.alarms, chrome.notifications
        ▲ runtime 메시지
        │
  ┌─────┴──────────┬────────────────────┬──────────────────────┐
툴바 아이콘 배지   사이드 패널          content script          MAIN world 스크립트
미제출 개수        마감 대시보드        KLAS 화면에 작은 UI     KLAS 동작을 꼭 바꿔야
                                       (Shadow DOM)           할 때만, 로직 없이
```

### 원칙

1. KLAS 요청은 background 한 곳에서만 보낸다. 탭이 여러 개여도 요청이 겹치지 않고, 세션 판단과 캐시를 한곳에서 관리한다.
2. service worker는 쉬고 있으면 종료된다. 상태는 변수가 아니라 `chrome.storage`에 둔다.
3. 화면은 캐시를 먼저 보여 주고 뒤에서 새로 고친다.
4. content script는 데이터를 직접 조회하지 않고 background에 요청한다.
5. MAIN world 스크립트는 최소한으로 둔다. 필요한 정보는 `CustomEvent`로 content script와 주고받는다.
6. 권한은 기능에 필요한 만큼만 요청한다.

## 화면

이슈 #7에서 결정했다 (2026-11-05).

### 방식: 툴바 배지 + 사이드 패널

- **툴바 아이콘 배지**: 미제출 마감 개수를 보여 준다. KLAS 로그인이 끊기면 다른 표시로 바꾼다.
- **아이콘을 누르면 사이드 패널**: 팝업은 쓰지 않는다. 팝업은 다른 곳을 누르면 닫히지만, 사이드 패널은 KLAS 과제 페이지를 보면서 옆에 띄워 둘 수 있다.
  - Chrome, Edge: `side_panel` + `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  - Firefox: `sidebar_action` + `action.onClicked`에서 `browser.sidebarAction.toggle()`
- **전체 화면 대시보드**는 따로 만들지 않는다. 필요해지면 사이드 패널의 "전체 보기"가 여는 확장 페이지로 만든다.
- **KLAS 화면 삽입**은 KLAS 화면 구조에 의존하므로 기본 기능에서 뺀다. 나중에 넣게 되면 선택 기능으로 하고, Shadow DOM 안에 그린다.

WXT의 `sidepanel` 진입점 하나로 Chrome 빌드에는 `side_panel`과 `sidePanel` 권한이, Firefox 빌드에는 `sidebar_action`이 만들어지는 것을 빌드로 확인했다. Edge도 Chrome과 같은 `chrome.sidePanel` API를 지원한다.

### UI 프레임워크: Preact

시안 A의 마감 목록(필터 버튼 5개, 항목 6개)을 같은 내용으로 네 번 만들어 운영 빌드한 결과:

| 방식 | JS 크기 | gzip 후 | 추가 설정 | 타입 검사, lint |
|---|---|---|---|---|
| 프레임워크 없음 | 2.4 KB | 1.1 KB | 없음 | 그대로 통과 |
| Preact 11 | 15 KB | 6.4 KB | Vite 플러그인, tsconfig 2줄 | 그대로 통과 |
| Svelte 5 | 35 KB | 13.8 KB | WXT 모듈 | `.svelte`는 `tsc`, ESLint로 검사되지 않아 `svelte-check`와 ESLint 플러그인이 더 필요 |
| React 19 | 221 KB | 68 KB | WXT 모듈, tsconfig 1줄 | 그대로 통과 |

Preact를 고른 이유:

- React와 문법이 같아서 React를 아는 기여자가 바로 참여할 수 있다.
- 크기가 React의 10분의 1이다. 사이드 패널은 열 때마다 새로 로드되므로 가벼운 편이 낫다.
- 지금의 검사 체계(`tsc`, ESLint, Vitest)를 그대로 쓴다.
- 프레임워크 없이 만들면 같은 화면에서도 DOM을 직접 다루는 코드가 길어져서, 화면이 늘어날수록 읽기 어려워진다.

설정할 때 필요한 것: `@preact/preset-vite`를 `wxt.config.ts`의 Vite 플러그인에 추가하고, `tsconfig.json`에 `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`를 넣는다. hooks 규칙을 검사하려면 `eslint-plugin-react-hooks`를 함께 쓴다.

## 검증된 사실 (2026-11-05, Chrome, 테스트 확장으로 확인)

- KLAS의 axios나 Vue 없이 `fetch`만으로 아래 API를 조회할 수 있다. CSRF 토큰이나 별도 헤더는 필요 없다.
- 확장 페이지, background(service worker), content script(격리 world) 세 곳 모두에서 로그인 쿠키가 실리고 같은 결과가 나왔다.
- Firefox는 아직 확인하지 않았다.

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

### 날짜 형식

API마다 다르다. 확인한 형식:

| 예시 | 쓰이는 곳 | 해석 |
|---|---|---|
| `2026-12-01 18:00:59` | 과제 `expiredate` | 한국 시간 |
| `2026-11-13T14:59:59.000+00:00` | 팀 프로젝트 `expiredate` | UTC (한국 시간 23:59:59) |
| `2026-10-12 23:59` | 온라인 강의 `endDate`, 퀴즈 `edt` | 한국 시간 |
| `202610122359` | 온라인 강의, 퀴즈 `edate` | 한국 시간 |

### 마감 판단 규칙 (기존 KLAS Helper `home.js`와 같음)

| 종류 | 대상 | 완료 조건 | 마감 |
|---|---|---|---|
| 온라인 강의 | `evltnSe === "lesson"` 이고 `isonoff !== "OFF"` | `prog === 100` | `endDate` 끝에 `:59` |
| 과제, 팀 프로젝트 | 전부 | `submityn === "Y"` | `expiredate`, 지났으면 `reexpiredate`(추가 제출 기한) |
| 퀴즈 | 전부 | `issubmit === "Y"` | `edt` |

## 아직 정하지 않은 것

- KLAS 세션이 끊기기까지 걸리는 시간과, 주기 조회가 세션을 연장하는지
- Firefox에서 실제 로드와 동작 확인 (빌드 결과의 `sidebar_action`과 event page 방식 background는 확인함)
- 기존 KLAS Helper 기능(성적 통계, 강의계획서 등) 중 무엇을 옮길지
