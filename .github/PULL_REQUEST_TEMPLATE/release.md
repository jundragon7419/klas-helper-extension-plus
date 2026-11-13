<!--
develop을 main으로 합치는 릴리스 PR 양식입니다. 절차는 CONTRIBUTING.md "배포"에 있습니다.
제목: Release KLAS Helper Extension Plus v<버전>
머지는 "Create a merge commit"으로 합니다(main ruleset이 merge만 허용).
-->

## 버전

v

## 포함된 변경

<!-- CHANGELOG.md의 이번 버전 항목을 사용자 관점으로 요약합니다. -->

-

## 배포 전 검사

- [ ] CI `check`와 `e2e`가 이 PR에서 통과했습니다. (Chromium 자동 E2E가 Chrome과 Edge를 대표합니다)
- [ ] `package.json`의 `version`과 CHANGELOG.md의 버전 제목을 올렸습니다.
- [ ] `npm run zip`, `npm run zip:firefox`로 배포 파일을 만들었습니다.
- [ ] 로그인한 Chrome 또는 Edge에서 배포 후보의 마감 조회와 자동 연장을 확인했습니다.

## Firefox 확인 목록

Firefox는 자동 E2E가 없어 릴리스마다 직접 확인합니다. `npm run zip:firefox`로 만든 파일을 Firefox에 임시 부가 기능으로 올리고(`about:debugging` → 이 Firefox → 임시 부가 기능 로드), 로그인한 KLAS에서 확인합니다.

- [ ] 설치: 부가 기능이 오류 없이 올라가고 `about:debugging`의 검사 콘솔에 오류가 없습니다.
- [ ] 사이트 권한: 부가 기능 관리(`about:addons`)의 권한 탭에서 `klas.kw.ac.kr` 접근이 허용되어 있습니다. 허용되어 있지 않았다면 그 사실을 아래 "확인 결과"에 적습니다.
- [ ] KLAS 탭 열기: KLAS 화면 오른쪽 손잡이로 KLAS Helper+ 패널이 열리고 닫힙니다.
- [ ] 마감 목록: 패널에 이번 학기 마감이 날짜별로 나오고, 항목을 누르면 해당 과목의 KLAS 목록으로 이동합니다.
- [ ] 세션 연장: KLAS 상단에 "자동 연장 중"이 보이고, 10분 넘게 둔 뒤에도 로그인이 유지됩니다.
- [ ] "릴리스 전 Firefox 확인 필요" PR: [`firefox-check` 라벨이 붙은 PR 목록](https://github.com/jundragon7419/klas-helper-extension-plus/pulls?q=is%3Apr+is%3Amerged+base%3Adevelop+label%3Afirefox-check)의 PR마다 본문에 적힌 확인 항목을 확인했습니다. 확인한 PR은 아래에 적고, 머지한 뒤 라벨을 지웁니다.

### 확인한 "Firefox 확인 필요" PR

<!-- 예: #140 KLAS 요청 방식 변경: Firefox에서 마감 조회 정상 -->

- 없음

### 확인 결과

<!-- Firefox 버전, 확인한 날, 다르게 동작한 점. 학번, 이름, 성적은 적지 않습니다. -->

-

## 배포

머지한 뒤 `main`에 `v<버전>` 태그를 만들고, 그 커밋에서 빌드한 Chrome, Firefox ZIP을 GitHub 릴리스에 첨부합니다.
