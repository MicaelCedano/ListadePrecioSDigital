-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Brands Table
create table if not exists brands (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text unique not null,
  color text default '#000000',
  order_index integer default 0
);

-- Inventory Table
create table if not exists inventory (
  id text primary key, -- Custom ID like "SAMSUNG-S24-128GB"
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  brand text references brands(name) on delete cascade, -- Optional foreign key
  model text not null,
  specs text,
  price_float numeric,
  price_str text
);

-- App Settings Table (Shared State)
create table if not exists app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Row Level Security (RLS)
alter table brands enable row level security;
alter table inventory enable row level security;
alter table app_settings enable row level security;

-- Drop existing policies to avoid "already exists" errors
drop policy if exists "Allow public read/write access" on brands;
drop policy if exists "Allow public read/write access" on inventory;
drop policy if exists "Allow public read/write access" on app_settings;

-- Re-create public access policies
create policy "Allow public read/write access" on brands for all using (true) with check (true);
create policy "Allow public read/write access" on inventory for all using (true) with check (true);
create policy "Allow public read/write access" on app_settings for all using (true) with check (true);
