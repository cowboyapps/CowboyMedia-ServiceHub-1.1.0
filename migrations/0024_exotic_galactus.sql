CREATE TABLE "whmcs_product_dns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whmcs_product_id" integer NOT NULL,
	"dns" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whmcs_product_dns_whmcs_product_id_unique" UNIQUE("whmcs_product_id")
);
