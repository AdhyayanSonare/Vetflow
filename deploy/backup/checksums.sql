-- Row counts and checksums of the stock ledger and balances. Run before a backup and after a restore:
-- the output must match exactly.
select 'rows:' || relname as check, n_live_tup::text as value from pg_stat_user_tables where relname <> 'schema_migrations' order by 1;
select 'ledger_md5' as check, md5(coalesce(string_agg(id::text || ':' || item_id::text || ':' || batch_id::text || ':' || type || ':' || quantity::text, ',' order by id), '')) as value from stock_ledger;
select 'balances_md5' as check, md5(coalesce(string_agg(batch_id::text || ':' || store_id::text || ':' || quantity::text, ',' order by batch_id, store_id), '')) as value from stock_balances;
select 'tenants' as check, count(*)::text as value from tenants;
