CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"description" text NOT NULL,
	"posted_at_raw" text,
	"posted_at" timestamp with time zone,
	"blocked_by" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postings_source_url_uniq" UNIQUE("source_id","url")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"listing_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"item_selector" text NOT NULL,
	"title_selector" text NOT NULL,
	"title_attr" text,
	"detail_url_selector" text NOT NULL,
	"detail_url_attr" text DEFAULT 'href' NOT NULL,
	"description_selector" text NOT NULL,
	"description_attr" text,
	"company_selector" text,
	"company_attr" text,
	"posted_at_selector" text,
	"posted_at_attr" text,
	"blocked_title_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"blocked_description_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"request_timeout_ms" integer DEFAULT 10000 NOT NULL,
	"detail_delay_ms" integer DEFAULT 1000 NOT NULL,
	"max_items_per_run" integer DEFAULT 100 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"blocked_title_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"blocked_description_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_user_name_uniq" ON "sources" USING btree ("user_id","name") WHERE "sources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sources_user_live_idx" ON "sources" USING btree ("user_id") WHERE "sources"."deleted_at" is null;