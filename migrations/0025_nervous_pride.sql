CREATE TABLE "whmcs_pending_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"whmcs_product_id" integer NOT NULL,
	"whmcs_invoice_id" integer,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "whmcs_pending_orders_user_id_idx" ON "whmcs_pending_orders" USING btree ("user_id");