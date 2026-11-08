ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "private_message" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "uploaded_files" SET "private_message" = true WHERE EXISTS (
  SELECT 1 FROM "thread_messages" WHERE "thread_messages"."image_url" = '/uploads/' || "uploaded_files"."filename"
);
