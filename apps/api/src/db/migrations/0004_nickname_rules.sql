ALTER TABLE "users" DROP CONSTRAINT "users_nickname_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_nickname_check" CHECK (char_length("users"."nickname") between 3 and 16
        and ("users"."nickname" ~ '^[A-Za-z][A-Za-z0-9_]*$' or "users"."nickname" ~ '^[А-Яа-яЁё][А-Яа-яЁё0-9_]*$'));