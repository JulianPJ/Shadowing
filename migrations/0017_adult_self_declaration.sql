-- Adult (18+) self-declaration timestamp. Nullable: existing accounts keep their data and confirm on
-- their next visit. No date of birth is stored.
alter table "user" add column "adultSelfDeclaredAt" date;
