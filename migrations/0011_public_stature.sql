ALTER TABLE "services" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "services" SET "is_default" = true WHERE "name" = 'CowboyMedia ServiceHub';
