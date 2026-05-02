#!/bin/bash
set -e
echo "Running migration: 001_trim_usernames.sql"
psql "$DATABASE_URL" -f migrations/001_trim_usernames.sql
echo "Running migration: 007_announcements.sql"
psql "$DATABASE_URL" -f migrations/007_announcements.sql
echo "Migration complete."
