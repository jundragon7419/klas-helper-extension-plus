#!/usr/bin/env bash
# 자동 흐름이 멈춘 이슈나 PR에 ai:needs-human 라벨을 붙이고, 메인테이너 계정으로 @codex 정리 요청을 단다.
# 메인테이너 알림은 ai-relay 워크플로가 Codex 정리 뒤(또는 30분 뒤)에 보낸다.
# 필요한 환경 변수: TARGET(이슈나 PR 번호), KIND(implement | round-limit | rebuttal | fix-failed), RUN_URL, KEY, GH_REPO,
#   GH_TOKEN(MAINTAINER_PR_TOKEN, 없으면 바로 알림), ACTIONS_TOKEN(github.token), MAINTAINER
# Claude가 건드린 작업 공간에서 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${TARGET:?TARGET이 필요합니다}" "${KIND:?KIND가 필요합니다}" "${RUN_URL:?}" "${KEY:?}"
: "${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}" "${MAINTAINER:?}"
here=$(dirname "$0")

# 이슈와 PR 모두 issues API로 다룬다.
GH_TOKEN="$ACTIONS_TOKEN" gh api -X POST "repos/$GH_REPO/issues/$TARGET/labels" -f "labels[]=ai:needs-human" > /dev/null

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::MAINTAINER_PR_TOKEN이 없어 Codex 요청 없이 바로 알립니다."
  GH_TOKEN="$ACTIONS_TOKEN" gh api -X POST "repos/$GH_REPO/issues/$TARGET/comments" \
    -f body="@$MAINTAINER 자동 흐름이 멈췄습니다. 위 Claude 보고와 실행 기록($RUN_URL)을 확인해 주세요." > /dev/null
  exit 0
fi

node "$here/relay.js" body "$KIND" "$RUN_URL" "$KEY" > "${RUNNER_TEMP:-/tmp}/codex-request.md"
gh api -X POST "repos/$GH_REPO/issues/$TARGET/comments" -F "body=@${RUNNER_TEMP:-/tmp}/codex-request.md" > /dev/null
