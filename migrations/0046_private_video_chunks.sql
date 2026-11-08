ALTER TABLE "uploaded_files" ADD COLUMN "chunked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD COLUMN "byte_size" integer;
--> statement-breakpoint
CREATE TABLE "uploaded_file_chunks" (
  "upload_id" varchar NOT NULL,
  "ordinal" integer NOT NULL,
  "data" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploaded_file_chunks" ADD CONSTRAINT "uploaded_file_chunks_upload_id_uploaded_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploaded_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uploaded_file_chunks_upload_ordinal_idx" ON "uploaded_file_chunks" USING btree ("upload_id", "ordinal");
