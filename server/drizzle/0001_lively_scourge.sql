CREATE TABLE "service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_tokens_org_idx" ON "service_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_external_idx" ON "courses" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_external_idx" ON "enrollments" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_idx" ON "users" USING btree ("external_id");