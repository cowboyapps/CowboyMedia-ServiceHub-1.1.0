CREATE TABLE "store_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whmcs_product_id" integer NOT NULL,
	"name" text,
	"description" text,
	"image_url" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_products_whmcs_product_id_unique" UNIQUE("whmcs_product_id")
);
