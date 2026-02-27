#!/bin/bash
# Auto-save script for Angel's Bail Bonds
# Commits and pushes all changes to GitHub every 5 minutes

PROJECT_DIR="/Users/emmanuelpableo/Workspaces/angels-bail-bonds"
LOG_FILE="$PROJECT_DIR/.autosave.log"

cd "$PROJECT_DIR" || exit 1

# Only commit if there are changes
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add .
  git commit -m "autosave: $(date '+%Y-%m-%d %H:%M:%S')"
  if git push origin main >> "$LOG_FILE" 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Saved and pushed" >> "$LOG_FILE"
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Saved locally but PUSH FAILED" >> "$LOG_FILE"
  fi
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') - No changes to save" >> "$LOG_FILE"
fi
