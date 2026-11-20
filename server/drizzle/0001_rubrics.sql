CREATE TABLE "rubric_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"assessor_id" uuid,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total" numeric(10, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"free_form_comments" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "rubric_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "rubric_use_for_grading" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_assessor_id_users_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_assessments_submission_idx" ON "rubric_assessments" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "rubric_assessments_rubric_idx" ON "rubric_assessments" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "rubrics_course_idx" ON "rubrics" USING btree ("course_id");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE set null ON UPDATE no action;