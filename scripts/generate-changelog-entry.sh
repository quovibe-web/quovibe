#!/usr/bin/env bash
# Genera bozza CHANGELOG entry dalla sessione corrente

if [ ! -f .claude/.session-start ]; then
  echo "❌ No session marker found. Run /preflight first."
  exit 1
fi

SESSION_START=$(cat .claude/.session-start)
TODAY=$(date +%Y-%m-%d)

# Count today's sessions for the letter suffix (0→A, 1→B, etc.)
EXISTING=$(grep -c "^## Session ${TODAY}-" docs/CHANGELOG-SESSIONS.md 2>/dev/null || echo 0)
LETTER=$(awk "BEGIN{printf \"%c\", 65+${EXISTING}}")

echo "## Session ${TODAY}-${LETTER} — ${TODAY} — [TITLE]"
echo ""
echo "**Original plan:** [fill in]"
echo "**Status:** Completed"
echo ""
echo "**Session commits:**"
git log --oneline "$SESSION_START"..HEAD 2>/dev/null || echo "(no commits)"
echo ""
echo "**Modified files:**"
FILES=$(git diff --name-only "$SESSION_START"..HEAD 2>/dev/null || echo "")
if [ -n "$FILES" ]; then
  echo "$FILES" | sort | while IFS= read -r f; do
    echo "- \`$f\`"
  done
else
  echo "(no files)"
fi
echo ""
echo "**Completed:**"
git log --format="- [x] %s" "$SESSION_START"..HEAD 2>/dev/null || echo "(no commits)"
echo ""
echo "**Deviations from plan:** [none | description]"
echo ""
echo "**Technical debt introduced:** [none | description]"
echo ""
echo "**Tests added/modified:**"
TEST_FILES=$(git diff --name-only "$SESSION_START"..HEAD 2>/dev/null | grep -E '\.test\.' | sort || echo "")
if [ -n "$TEST_FILES" ]; then
  echo "$TEST_FILES" | while IFS= read -r f; do
    echo "- \`$f\`"
  done
else
  echo "(none)"
fi
