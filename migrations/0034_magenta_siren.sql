CREATE TABLE "idempotency_keys" (
	"scoped_key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"status" integer,
	"body" jsonb,
	"expires_at" bigint NOT NULL
);
