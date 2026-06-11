CREATE TABLE "whmcs_product_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whmcs_product_id" integer NOT NULL,
	"service_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whmcs_product_mappings" ADD CONSTRAINT "whmcs_product_mappings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whmcs_product_mappings_pid_service_uniq" ON "whmcs_product_mappings" USING btree ("whmcs_product_id","service_id");--> statement-breakpoint
CREATE INDEX "whmcs_product_mappings_service_id_idx" ON "whmcs_product_mappings" USING btree ("service_id");