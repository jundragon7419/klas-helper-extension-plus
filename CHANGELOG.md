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

### 변경

- 개발 브랜치를 `develop`으로 정하고 기여 규칙과 CI를 맞춤 (#2)
- 커밋 메시지와 이슈 제목에 gitmoji를 쓰지 않도록 규칙 변경 (#4)
- TypeScript를 7.0에서 6.0으로 고정. typescript-eslint가 아직 7을 지원하지 않음 (#9)
- CI의 `actions/checkout`, `actions/setup-node`를 v7로 올림. v4의 Node 20 지원 종료 경고 해소 (#13)
- 문서와 PR 템플릿의 브라우저 안내를 Chrome 계열(Chrome, Edge) 기준으로 바꿈 (#13)
- 확장 방향 변경: KLAS를 보고 있을 때만 돕고, 화면은 브라우저 사이드 패널 대신 KLAS 안의 탭으로 바꿈. KLAS 요청은 KLAS 탭에서 보내고, 세션 연장과 확장 표시 원칙을 추가함. 알림과 툴바 배지는 추가 기능으로 미룸 (#14)

### 수정

- CI가 `package.json`이나 검사 스크립트가 없을 때 검사를 건너뛰고 통과하던 문제 (#13)
