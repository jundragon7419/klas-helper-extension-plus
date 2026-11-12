#!/usr/bin/env bash
# 자동 흐름이 멈춘 이슈나 PR에 ai:needs-human 라벨을 붙이고, 메인테이너 계정으로 @codex 정리 요청을 단다.
# 메인테이너 알림은 ai-relay 워크플로가 Codex 정리 뒤(또는 30분 뒤)에 보낸다.
# Claude의 ask가 MAX_ASKS(scripts/ai/relay.js)를 넘었거나 같은 질문이 반복되면 Codex 대신 바로 알린다.
# 필요한 환경 변수: TARGET(이슈나 PR 번호), KIND(implement | round-limit | rebuttal | fix-failed), RUN_URL, KEY, GH_REPO,
#   GH_TOKEN(MAINTAINER_PR_TOKEN, 없으면 바로 알림), ACTIONS_TOKEN(github.token), MAINTAINER
# Claude가 건드린 작업 공간에서 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${TARGET:?TARGET이 필요합니다}" "${KIND:?KIND가 필요합니다}" "${RUN_URL:?}" "${KEY:?}"
: "${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}" "${MAINTAINER:?}"
here=$(dirname "$0")

# 이슈와 PR 모두 issues API로 다룬다.
GH_TOKEN="$ACTIONS_TOKEN" gh api -X POST "repos/$GH_REPO/issues/$TARGET/labels" -f "labels[]=ai:needs-human" > /dev/null

# Codex에게 요청하지 못하면 ai-relay의 알림도 오지 않으므로 바로 알린다.
notify_now() {
  echo "::warning::$1"
  GH_TOKEN="$ACTIONS_TOKEN" gh api -X POST "repos/$GH_REPO/issues/$TARGET/comments" \
    -f body="@$MAINTAINER 자동 흐름이 멈췄습니다. 이유: $1. 위 Claude 메시지와 실행 기록($RUN_URL)을 확인해 주세요." > /dev/null
}

if [ -z "${GH_TOKEN:-}" ]; then
  notify_now "MAINTAINER_PR_TOKEN이 없어 Codex에게 요청하지 못함"
  exit 0
fi

tmp=${RUNNER_TEMP:-/tmp}
# Claude가 남긴 ask/objection을 찾고, 질문 횟수와 반복을 보고 Codex에게 넘길지 정한다.
GH_TOKEN="$ACTIONS_TOKEN" gh api "repos/$GH_REPO/issues/$TARGET/comments" --paginate \
  --jq '.[] | {id, login: .user.login, body}' > "$tmp/thread.jsonl"
plan=$(MAINTAINER="$MAINTAINER" node "$here/relay.js" plan "$tmp/thread.jsonl")
target=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).target)' "$plan")
ask_id=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).askId ?? ""))' "$plan")
reason=$(node -e 'const p = JSON.parse(process.argv[1]); process.stdout.write([p.reason, ...p.errors].join(" / ").replace(/<!--/g, "&lt;!--").replace(/-->/g, "--&gt;"))' "$plan")
if [ "$target" = user ]; then
  notify_now "$reason"
  exit 0
fi

node "$here/relay.js" body "$KIND" "$RUN_URL" "$KEY" $ask_id > "$tmp/codex-request.md"
if ! gh api -X POST "repos/$GH_REPO/issues/$TARGET/comments" -F "body=@$tmp/codex-request.md" > /dev/null; then
  # 토큰이 만료됐거나 권한이 부족한 경우. ai-implement의 PR 열기가 같은 이유로 실패했을 때도 여기로 온다.
  notify_now "MAINTAINER_PR_TOKEN으로 Codex 요청을 달지 못함"
fi
