#!/usr/bin/env bash
# 검토 반영을 push했으면 Codex 재검토가 돌게 한다.
# Codex는 지금 설정에서 새 커밋을 스스로 검토한다(PR #129 이후 확인. 처음에는 하지 않았다: PR #103, #111).
# 자동 검토가 시작되면 요청하지 않고, 정해진 시간 안에 시작하지 않을 때만 메인테이너 계정으로 "@codex review"를 단다.
# 둘 다 하면 같은 커밋을 두 번 검토한다.
# 필요한 환경 변수: GH_REPO, PR, BEFORE(검토 반영 전 head SHA),
#   GH_TOKEN(MAINTAINER_PR_TOKEN, 없으면 요청하지 않음), ACTIONS_TOKEN(github.token)
# 선택: CODEX_BOT(기본 chatgpt-codex-connector[bot]), CODEX_AUTO_REVIEW_WAIT(자동 검토를 기다릴 초, 기본 180)
# Claude가 건드린 작업 공간에서 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${PR:?PR이 필요합니다}" "${BEFORE:?BEFORE가 필요합니다}"
: "${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}"

now=$(GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/pulls/$PR" --jq .head.sha)
if [ "$now" = "$BEFORE" ]; then
  echo "새 커밋이 없어 재검토를 요청하지 않습니다."
  exit 0
fi

codex_bot=${CODEX_BOT:-chatgpt-codex-connector[bot]}
# 자동 검토가 시작됐는지: 요약 댓글의 상태 표시가 새 head를 가리키거나, Codex가 PR에 👀(검토 중)를 달았다.
started() {
  GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$PR/comments" --paginate \
    --jq ".[] | select(.user.login == \"$codex_bot\") | .body" | grep -q "\"commit_sha\":\"$now\"" && return 0
  GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$PR/reactions" \
    --jq ".[] | select(.user.login == \"$codex_bot\" and .content == \"eyes\") | .id" | grep -q .
}
deadline=$((SECONDS + ${CODEX_AUTO_REVIEW_WAIT:-180}))
while :; do
  if started; then
    echo "Codex가 ${now:0:7}을 스스로 검토하고 있어 재검토를 요청하지 않습니다."
    exit 0
  fi
  [ "$SECONDS" -ge "$deadline" ] && break
  sleep 20
done

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::MAINTAINER_PR_TOKEN이 없어 Codex 재검토를 요청하지 못했습니다."
  exit 0
fi
gh api -X POST "repos/$GH_REPO/issues/$PR/comments" -f body='@codex review' > /dev/null
echo "Codex 자동 검토가 시작되지 않아 ${now:0:7} 재검토를 요청했습니다."
