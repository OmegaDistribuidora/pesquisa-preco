import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || "";

export const pool = new Pool({
  connectionString: databaseUrl || "postgres://invalid:invalid@127.0.0.1:5432/invalid",
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

export async function migrate() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao configurada. Aponte para um banco Postgres local ou para o Postgres do Railway.");
  }

  await pool.query(`
    create table if not exists surveys (
      id uuid primary key,
      title text not null,
      description text not null default '',
      image_url text,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      closed_at timestamptz,
      created_at timestamptz not null default now()
    );

    alter table surveys add column if not exists closed_at timestamptz;
    alter table surveys add column if not exists image_url text;

    create table if not exists questions (
      id uuid primary key,
      survey_id uuid not null references surveys(id) on delete cascade,
      position integer not null,
      title text not null,
      kind text not null check (kind in ('short_text','long_text','options','dropdown','rating','upload')),
      required boolean not null default false,
      text_type text check (text_type in ('text','integer','decimal','currency')),
      options jsonb not null default '[]'::jsonb,
      multiple boolean not null default false,
      has_file boolean not null default false,
      file_max_mb integer,
      image_name text,
      image_path text,
      image_mime text,
      created_at timestamptz not null default now()
    );

    alter table questions add column if not exists image_name text;
    alter table questions add column if not exists image_path text;
    alter table questions add column if not exists image_mime text;

    create table if not exists responses (
      id uuid primary key,
      survey_id uuid not null references surveys(id) on delete cascade,
      respondent_key text not null,
      submitted_at timestamptz not null default now(),
      ip_hash text,
      user_agent text
    );

    alter table responses drop constraint if exists responses_survey_id_respondent_key_key;

    create table if not exists answers (
      id uuid primary key,
      response_id uuid not null references responses(id) on delete cascade,
      question_id uuid not null references questions(id) on delete cascade,
      no_answer boolean not null default false,
      no_answer_reason text,
      value_text text,
      value_number numeric,
      value_json jsonb,
      file_name text,
      file_path text,
      file_mime text,
      file_size integer
    );

    alter table answers add column if not exists no_answer boolean not null default false;
    alter table answers add column if not exists no_answer_reason text;

    create table if not exists answer_files (
      id uuid primary key,
      answer_id uuid not null references answers(id) on delete cascade,
      file_name text not null,
      file_path text not null,
      file_mime text,
      file_size integer not null,
      created_at timestamptz not null default now()
    );
  `);
}
