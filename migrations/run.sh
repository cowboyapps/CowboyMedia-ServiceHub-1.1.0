#!/bin/bash
set -e
echo "Running migration: 001_trim_usernames.sql"
psql "$DATABASE_URL" -f migrations/001_trim_usernames.sql
echo "Running migration: 007_announcements.sql"
psql "$DATABASE_URL" -f migrations/007_announcements.sql
echo "Running migration: 008_notification_prefs.sql"
psql "$DATABASE_URL" -f migrations/008_notification_prefs.sql
echo "Running migration: 009_status_page.sql"
psql "$DATABASE_URL" -f migrations/009_status_page.sql
echo "Running migration: 010_onboarding_tour.sql"
psql "$DATABASE_URL" -f migrations/010_onboarding_tour.sql
echo "Migration complete."
