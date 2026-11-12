#!/usr/bin/env bash
# AI review loop에서 Claude가 커밋만 해 둔 검토 반영(git bundle)을 검사한 뒤 메인테이너 토큰으로 PR 브랜치에 push한다.
# GITHUB_TOKEN으로 push하면 그 push로 시작되는 CI가 승인 대기에 걸리므로, push는 이 스크립트만 한다.
# 필요한 환경 변수: GH_TOKEN(MAINTAINER_PR_TOKEN, Contents 쓰기), GH_REPO, BRANCH(PR head 브랜치),
#   BEFORE(Claude 작업 전 head SHA), BUNDLE(git bundle 경로)
#   REMOTE_URL(테스트용. 없으면 https://github.com/$GH_REPO.git)
# Claude가 건드린 작업 공간에서 실행하지 않는다. 기본 브랜치를 새로 체크아웃한 작업에서만 부른다.
# tests/push-fix.test.ts가 로컬 저장소로 동작을 검사한다.
set -euo pipefail

: "${GH_REPO:?GH_REPO가 필요합니다}" "${BRANCH:?BRANCH가 필요합니다}" "${BEFORE:?BEFORE가 필요합니다}"
: "${BUNDLE:?BUNDLE이 필요합니다}"
fail() { echo "::error::$*"; exit 1; }

[ -n "${GH_TOKEN:-}" ] || fail "MAINTAINER_PR_TOKEN secret이 없어 검토 반영을 push할 수 없습니다."
[[ "$BEFORE" =~ ^[0-9a-f]{40}$ ]] || fail "BEFORE가 커밋 SHA가 아닙니다: $BEFORE"
# 작업 브랜치에만 push한다. develop, main은 ruleset도 막지만 여기서 먼저 거른다.
[[ "$BRANCH" =~ ^(feat|fix|refactor|test|docs|chore)/[1-9][0-9]*-[a-z0-9]+(-[a-z0-9]+)*$ ]] \
  || fail "작업 브랜치가 아니어서 push하지 않습니다: $BRANCH"
[ -f "$BUNDLE" ] || fail "검토 반영 bundle이 없습니다: $BUNDLE"

remote=${REMOTE_URL:-"https://x-access-token:${GH_TOKEN}@github.com/${GH_REPO}.git"}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work"
cd "$work"

# Claude 작업 뒤 다른 push가 있었다면 그 위에 덮어쓰지 않는다.
git fetch -q "$remote" "refs/heads/$BRANCH:refs/remotes/pr/head"
remote_head=$(git rev-parse refs/remotes/pr/head)
[ "$remote_head" = "$BEFORE" ] \
  || fail "Claude 작업 중에 $BRANCH 가 바뀌었습니다 (작업 전 ${BEFORE:0:7}, 지금 ${remote_head:0:7})."

git bundle verify -q "$BUNDLE" > /dev/null 2>&1 || fail "bundle이 작업 전 커밋 위에서 만들어지지 않았습니다."
git fetch -q "$BUNDLE" "HEAD:refs/ai/fix"
after=$(git rev-parse refs/ai/fix)
[ "$after" != "$BEFORE" ] || fail "bundle에 새 커밋이 없습니다."
git merge-base --is-ancestor "$BEFORE" "$after" \
  || fail "검토 반영이 작업 전 커밋에서 이어지지 않습니다(fast-forward 아님)."

# 자동 흐름은 워크플로 파일을 바꾸지 않는다(docs/AI-COLLABORATION.md "안전 장치").
workflows=$(git diff --name-only "$BEFORE" "$after" -- .github/workflows/)
[ -z "$workflows" ] || fail "워크플로 파일을 바꾼 검토 반영은 push하지 않습니다: $(echo $workflows)"

git push -q "$remote" "$after:refs/heads/$BRANCH"
echo "after=$after" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "${BRANCH}: ${BEFORE:0:7} -> ${after:0:7} push"
