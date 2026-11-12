#!/usr/bin/env bash
# 검토 반영을 push했으면 메인테이너 계정으로 "@codex review"를 단다.
# Codex는 PR을 연 뒤의 push를 스스로 다시 검토하지 않는다(PR #103, #111에서 확인).
# 필요한 환경 변수: GH_REPO, PR, BEFORE(검토 반영 전 head SHA),
#   GH_TOKEN(MAINTAINER_PR_TOKEN, 없으면 요청하지 않음), ACTIONS_TOKEN(github.token)
# Claude가 건드린 작업 공간에서 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${PR:?PR이 필요합니다}" "${BEFORE:?BEFORE가 필요합니다}"
: "${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}"

now=$(GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/pulls/$PR" --jq .head.sha)
if [ "$now" = "$BEFORE" ]; then
  echo "새 커밋이 없어 재검토를 요청하지 않습니다."
  exit 0
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::MAINTAINER_PR_TOKEN이 없어 Codex 재검토를 요청하지 못했습니다."
  exit 0
fi
gh api -X POST "repos/$GH_REPO/issues/$PR/comments" -f body='@codex review' > /dev/null
echo "${now:0:7} 재검토를 요청했습니다."
