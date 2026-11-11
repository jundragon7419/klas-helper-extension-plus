#!/usr/bin/env bash
# AI implement 워크플로에서 Claude가 남긴 .ai-pr/title.txt, .ai-pr/body.md로 메인테이너 계정의 PR을 연다.
# 필요한 환경 변수: GH_TOKEN(MAINTAINER_PR_TOKEN), ACTIONS_TOKEN(github.token), ISSUE(이슈 번호), GH_REPO
# tests/open-ai-pr.test.ts가 가짜 gh로 동작을 검사한다.
set -euo pipefail

: "${ISSUE:?ISSUE가 필요합니다}"

if [ -z "${GH_TOKEN:-}" ]; then echo "::error::MAINTAINER_PR_TOKEN secret이 없습니다."; exit 1; fi
branch=$(git rev-parse --abbrev-ref HEAD)
if ! [[ "$branch" =~ ^(feat|fix|refactor|docs|chore)/${ISSUE}- ]]; then
  echo "::error::브랜치 이름이 규칙과 다릅니다: $branch"; exit 1
fi
if [ "$(git ls-remote origin "refs/heads/$branch" | cut -f1)" != "$(git rev-parse HEAD)" ]; then
  echo "::error::$branch 의 현재 커밋이 원격에 없습니다."; exit 1
fi
title=$(head -n 1 .ai-pr/title.txt)
args=(--base develop --head "$branch" --title "$title" --body-file .ai-pr/body.md --assignee jundragon7419 --label ai:in-progress)
while IFS= read -r label; do [ -n "$label" ] && args+=(--label "$label"); done \
  < <(gh issue view "$ISSUE" --json labels --jq '.labels[].name')
milestone=$(gh issue view "$ISSUE" --json milestone --jq '.milestone.title // empty')
[ -n "$milestone" ] && args+=(--milestone "$milestone")
url=$(gh pr create "${args[@]}")
number=${url##*/}
sed -i "s/(#PR)/(#$number)/" .ai-pr/body.md
gh pr edit "$number" --body-file .ai-pr/body.md
GH_TOKEN="${ACTIONS_TOKEN:?ACTIONS_TOKEN이 필요합니다}" gh issue comment "$ISSUE" --body "PR을 열었습니다: $url"
echo "PR: $url" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
