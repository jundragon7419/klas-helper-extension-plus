#!/usr/bin/env bash
# PR에 새 커밋이 push되면 Codex 리뷰가 돌게 한다. Codex review request 워크플로가 develop으로 가는 모든 PR에서 부른다.
# Codex는 push된 커밋을 스스로 리뷰하기도 하고 하지 않기도 한다(#129, #131은 했고 #135는 하지 않음).
# 리뷰가 시작되면 요청하지 않고, 정해진 시간 안에 시작하지 않을 때만 메인테이너 계정으로 "@codex review"를 단다.
# 둘 다 하면 같은 커밋을 두 번 리뷰한다. 사람이 이미 "@codex review"를 달았어도 다시 달지 않는다.
# 필요한 환경 변수: GH_REPO, PR, BEFORE(push 전 head SHA),
#   GH_TOKEN(MAINTAINER_PR_TOKEN, 없으면 요청하지 않음), ACTIONS_TOKEN(github.token)
# 선택: CODEX_BOT(기본 chatgpt-codex-connector[bot]), MAINTAINER(기본 jundragon7419),
#   CODEX_AUTO_REVIEW_WAIT(리뷰 시작을 기다릴 초, 기본 180)
# PR 브랜치의 파일로 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${PR:?PR이 필요합니다}" "${BEFORE:?BEFORE가 필요합니다}"
: "${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}"

now=$(GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/pulls/$PR" --jq .head.sha)
if [ "$now" = "$BEFORE" ]; then
  echo "새 커밋이 없어 재검토를 요청하지 않습니다."
  exit 0
fi

codex_bot=${CODEX_BOT:-chatgpt-codex-connector[bot]}
maintainer=${MAINTAINER:-jundragon7419}
# 👀는 이전 리뷰 때 단 것이 남아 있을 수 있다. push 직후에 실행되므로, 시작 1분 전 이후에 단 것만 이번 커밋의 리뷰로 본다.
# head 커밋 시각은 기준으로 쓰지 않는다. Claude가 커밋한 뒤 push까지 수십 분이 걸려, 그 사이의 이전 리뷰 👀를 잘못 셀 수 있다.
since=${REVIEW_SINCE:-$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)}
# 리뷰가 시작됐는지: 요약 댓글의 상태 표시가 새 head를 가리키거나, Codex가 PR에 👀(리뷰 중)를 달았거나,
# push 뒤에 메인테이너가 "@codex review"를 이미 달았다.
started() {
  GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$PR/comments" --paginate \
    --jq ".[] | select(.user.login == \"$codex_bot\") | .body" | grep -q "\"commit_sha\":\"$now\"" && return 0
  GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$PR/comments" --paginate \
    --jq ".[] | select(.user.login == \"$maintainer\" and .created_at >= \"$since\" and (.body | test(\"^\\\\s*@codex review\\\\s*$\"))) | .id" \
    | grep -q . && return 0
  GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$PR/reactions" \
    --jq ".[] | select(.user.login == \"$codex_bot\" and .content == \"eyes\" and .created_at >= \"$since\") | .id" | grep -q .
}
deadline=$((SECONDS + ${CODEX_AUTO_REVIEW_WAIT:-180}))
while :; do
  if started; then
    echo "Codex가 ${now:0:7}을 이미 리뷰하고 있거나 요청을 받아 재검토를 요청하지 않습니다."
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
