CREATE TABLE "assignment_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"use_for_grading" boolean DEFAULT true NOT NULL,
	"hide_points" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"rubric_id" uuid,
	"rubric_title" text NOT NULL,
	"assessor_id" uuid,
	"attempt" integer,
	"total" numeric(10, 2),
	"points_possible" numeric(10, 2) DEFAULT 0 NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"points" numeric(10, 2) DEFAULT 0 NOT NULL,
	"levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"course_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_rubrics" ADD CONSTRAINT "assignment_rubrics_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rubrics" ADD CONSTRAINT "assignment_rubrics_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_assessor_id_users_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_rubrics_assignment_idx" ON "assignment_rubrics" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_rubrics_rubric_idx" ON "assignment_rubrics" USING btree ("rubric_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_assessments_submission_idx" ON "rubric_assessments" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "rubric_assessments_rubric_idx" ON "rubric_assessments" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "rubric_criteria_rubric_idx" ON "rubric_criteria" USING btree ("rubric_id","position");--> statement-breakpoint
CREATE INDEX "rubrics_course_idx" ON "rubrics" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "rubrics_org_idx" ON "rubrics" USING btree ("org_id");