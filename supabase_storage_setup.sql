-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Crée le bucket privé de modèles et limite chaque utilisateur à son propre dossier.
insert into storage.buckets (id, name, public)
values ('khaleb-models', 'khaleb-models', false)
on conflict (id) do update set public = false;

drop policy if exists khaleb_models_select_own on storage.objects;
drop policy if exists khaleb_models_insert_own on storage.objects;
drop policy if exists khaleb_models_update_own on storage.objects;
drop policy if exists khaleb_models_delete_own on storage.objects;

create policy khaleb_models_select_own on storage.objects
for select to authenticated
using (bucket_id = 'khaleb-models' and (storage.foldername(name))[1] = auth.uid()::text);

create policy khaleb_models_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'khaleb-models' and (storage.foldername(name))[1] = auth.uid()::text);

create policy khaleb_models_update_own on storage.objects
for update to authenticated
using (bucket_id = 'khaleb-models' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'khaleb-models' and (storage.foldername(name))[1] = auth.uid()::text);

create policy khaleb_models_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'khaleb-models' and (storage.foldername(name))[1] = auth.uid()::text);
