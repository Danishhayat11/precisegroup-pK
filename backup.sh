#!/bin/bash
set -e

# Generate a timestamp for the backup filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$HOME/Desktop/precisegroup-pk-backup-$TIMESTAMP.zip"

echo "Creating backup..."

# Zip the current directory excluding common large/unnecessary directories
zip -r "$BACKUP_FILE" . -x "node_modules/*" ".git/*" ".next/*" "dist/*" ".fuzz-seed-store/*" "test-results/*"

echo "Backup created successfully at: $BACKUP_FILE"
