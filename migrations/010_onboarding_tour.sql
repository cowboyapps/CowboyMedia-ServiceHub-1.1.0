-- Add onboarding tour completion timestamp on users.
-- Null = tour has not been completed/skipped yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at TIMESTAMP;
