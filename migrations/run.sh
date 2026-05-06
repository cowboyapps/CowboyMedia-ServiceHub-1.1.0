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
echo "Running migration: 009_knowledge_base.sql"
psql "$DATABASE_URL" -f migrations/009_knowledge_base.sql
echo "Running migration: 010_onboarding_tour.sql"
psql "$DATABASE_URL" -f migrations/010_onboarding_tour.sql
echo "Running migration: 011_ticket_sla.sql"
psql "$DATABASE_URL" -f migrations/011_ticket_sla.sql
echo "Running migration: 012_alert_postmortems.sql"
psql "$DATABASE_URL" -f migrations/012_alert_postmortems.sql
echo "Running migration: 013_public_status_subscribers.sql"
psql "$DATABASE_URL" -f migrations/013_public_status_subscribers.sql
echo "Running migration: 014_discord_settings.sql"
psql "$DATABASE_URL" -f migrations/014_discord_settings.sql
echo "Running migration: 015_per_service_discord_webhook.sql"
psql "$DATABASE_URL" -f migrations/015_per_service_discord_webhook.sql
echo "Migration complete."
