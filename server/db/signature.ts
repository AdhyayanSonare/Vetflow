import type pg from "pg";

/**
 * A normalised description of the public schema: columns, constraints, indexes, functions,
 * policies, triggers, row-level-security flags, views and the app role's table privileges.
 * Two databases with the same signature behave the same. Used to verify a database that was
 * migrated by hand before recording it as migrated.
 */
export type Signature = Record<string, Map<string, string>>;

const SECTIONS: Record<string, string> = {
  columns: `select table_name || '.' || column_name k, data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') v
              from information_schema.columns where table_schema = 'public' and table_name <> 'schema_migrations'`,
  constraints: `select conrelid::regclass::text || '.' || conname k, pg_get_constraintdef(oid) v
                  from pg_constraint where connamespace = 'public'::regnamespace and contype <> 'n' and conrelid::regclass::text <> 'schema_migrations'`,
  indexes: `select indexname k, indexdef v from pg_indexes where schemaname = 'public' and tablename <> 'schema_migrations'`,
  functions: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k, md5(p.prosrc) || ' secdef=' || p.prosecdef v
                from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  policies: `select tablename || '.' || policyname k, coalesce(qual, '') || ' | ' || coalesce(with_check, '') v from pg_policies where schemaname = 'public'`,
  triggers: `select tgrelid::regclass::text || '.' || tgname k, pg_get_triggerdef(oid) v
               from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`,
  rowSecurity: `select relname k, relrowsecurity::text || ' forced=' || relforcerowsecurity::text v
                  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'schema_migrations'`,
  views: `select viewname k, md5(definition) v from pg_views where schemaname = 'public'`,
  appPrivileges: `select table_name || '.' || privilege_type k, '' v from information_schema.role_table_grants
                   where grantee = 'vetflow_app' and table_schema = 'public' and table_name <> 'schema_migrations'`,
};

export async function schemaSignature(c: pg.ClientBase): Promise<Signature> {
  const out: Signature = {};
  for (const [name, sql] of Object.entries(SECTIONS)) {
    const rows = (await c.query(sql)).rows as Array<{ k: string; v: string }>;
    out[name] = new Map(rows.map(r => [r.k, r.v]));
  }
  return out;
}

export type SignatureDiff = { section: string; key: string; kind: "missing" | "different" | "extra"; expected?: string; actual?: string };

/** `missing` and `different` mean the target does not match. `extra` objects are reported but do not fail the check. */
export function diffSignatures(expected: Signature, actual: Signature): SignatureDiff[] {
  const out: SignatureDiff[] = [];
  for (const section of Object.keys(expected)) {
    for (const [key, v] of expected[section]) {
      const a = actual[section].get(key);
      if (a === undefined) out.push({ section, key, kind: "missing", expected: v });
      else if (a !== v) out.push({ section, key, kind: "different", expected: v, actual: a });
    }
    for (const [key, v] of actual[section]) if (!expected[section].has(key)) out.push({ section, key, kind: "extra", actual: v });
  }
  return out;
}
