# 변경 기록

이 프로젝트의 주요 변경 사항을 기록합니다. 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### 추가

- 저장소 초기 구성: LICENSE, README, CONTRIBUTING, SECURITY, PRIVACY 초안, ARCHITECTURE 문서, 이슈와 PR 템플릿, CI 설정
- 메인테이너용 작업 이슈 양식
- WXT 0.21과 TypeScript로 만든 확장 골격. Chrome과 Firefox 모두 Manifest V3로 빌드 (#8)
- ESLint, Prettier, Vitest 설정과 CI 검사 (#9, #10)
- VS Code 추천 확장과 저장할 때 자동 포맷 설정 (#10)
- 화면 방식과 UI 프레임워크 결정 기록: 툴바 배지와 사이드 패널, Preact (#11)
- CI에 Firefox 빌드 검사 (#13)
- 전체 계획 문서 `docs/ROADMAP.md` (#14)
- 세션 연장 요청 조사 결과와 결정: `UpdateSession.do`로 연장하고 `session/info`로 상태 확인 (#16)
- Firefox content script의 KLAS 요청 확인 결과: 기본 `fetch`로 동작, 추적 방지 "엄격"에서도 동일 (#17)
- KLAS 응답 수집 스크립트와 개인정보 제거 스크립트, 2026년 2학기 테스트 자료 (#19)
- `web-ext`를 개발 의존성으로 추가. 없으면 WXT가 `npm run dev`에서 브라우저를 띄우지 않음. 시작 주소를 KLAS로 지정하고, Edge 실행과 저장한 비밀번호, 설정이 유지되는 개발 프로필을 위한 개인 설정 예시 `web-ext.config.example.ts` 추가 (#18)
- KLAS 날짜 문자열을 PC 시간대와 관계없이 한국 시간으로 해석하는 `parseKlasDate` (#20)
- KLAS API 조회 함수 다섯 개와 응답 검사. 실패를 세션 만료, 네트워크, JSON 아님, 형식 바뀜으로 구분. KLAS 페이지 content script 추가 (개발 빌드에서만 API 확인 실행) (#21)
- 네 종류 목록을 하나의 마감 형식으로 정리하는 `normalizeSubject`와 마감 순 정렬, 한국 날짜로 조회할 학기를 고르는 `pickCurrentSemester` (#22)
- 여러 KLAS 탭 중 한 곳만 마감을 조회하는 background 조정과 `storage.local` 캐시. 5분 안의 결과는 다시 쓰고, 실패해도 이전 결과를 유지. `storage` 권한 추가 (#23)
- KLAS 탭이 열려 있는 동안 10분마다 세션 연장. 연장 뒤 남은 시간으로 로그인이 살아 있는지 확인하고, 끊겼으면 마감 캐시에 기록. 설정 값 `sessionKeepAlive`(기본 켜짐), `alarms` 권한 추가 (#24)
- KLAS 탭 디자인 결정: KLAS 색과 글꼴, "KLAS Helper+" 바와 탭 줄, 폭 360px, 손잡이, 좁은 창. KLAS 안에 넣는 요소는 KLAS 마크업 그대로 두고 (+) 표시만 붙임. 디자인 토큰 `utils/ui/tokens.ts`와 대비 검사 테스트, 값을 바꿔 보고 저장하는 미리보기 페이지 `npm run tokens:preview` (#25)

### 변경

- 개발 브랜치를 `develop`으로 정하고 기여 규칙과 CI를 맞춤 (#2)
- 커밋 메시지와 이슈 제목에 gitmoji를 쓰지 않도록 규칙 변경 (#4)
- TypeScript를 7.0에서 6.0으로 고정. typescript-eslint가 아직 7을 지원하지 않음 (#9)
- CI의 `actions/checkout`, `actions/setup-node`를 v7로 올림. v4의 Node 20 지원 종료 경고 해소 (#13)
- 문서와 PR 템플릿의 브라우저 안내를 Chrome 계열(Chrome, Edge) 기준으로 바꿈 (#13)
- 확장 방향 변경: KLAS를 보고 있을 때만 돕고, 화면은 브라우저 사이드 패널 대신 KLAS 안의 탭으로 바꿈. KLAS 요청은 KLAS 탭에서 보내고, 세션 연장과 확장 표시 원칙을 추가함. 알림과 툴바 배지는 추가 기능으로 미룸 (#14)

### 수정

- CI가 `package.json`이나 검사 스크립트가 없을 때 검사를 건너뛰고 통과하던 문제 (#13)
- `formatRemaining`이 숫자가 아닌 값을 받으면 "NaN일 NaN시간"을 돌려주던 문제. 이제 "알 수 없음" (#20)
- content script가 storage.session 항목을 불러와 "Access to storage is not allowed from this context" 오류를 내던 문제. background가 아직 준비되지 않았을 때 content script가 멈추던 문제 (#36)
