CREATE TABLE "whmcs_invoice_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"whmcs_invoice_id" integer NOT NULL,
	"last_notified_stage" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whmcs_invoice_notifications_user_invoice_uniq" ON "whmcs_invoice_notifications" USING btree ("user_id","whmcs_invoice_id");