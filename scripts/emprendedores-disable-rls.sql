-- ================================================================
-- Deja TODAS las tablas y vistas del esquema "emprendedores" como
-- "Unrestricted" (sin RLS) Y con permisos para que anon/authenticated
-- puedan leer/escribir via PostgREST. Cubre tablas presentes y futuras.
-- ================================================================
-- Coherente con el esquema "colmena" en produccion: ese tampoco usa RLS,
-- el control de acceso se hace 100% en la capa de la app (getTenantStamp()
-- + razon_social_id), no a nivel de Postgres.
--
-- Nota de seguridad: con esto cualquiera con la ANON key puede leer/escribir
-- directamente cualquier tabla via PostgREST. Es igual al comportamiento
-- actual de "colmena", no es un riesgo nuevo — solo lo señalo por si en
-- algun momento quieres blindar esto con policies en vez de confiar solo
-- en el aislamiento a nivel de aplicacion.
--
-- Seguro de re-ejecutar (todo es idempotente).
-- ================================================================

-- 1) RLS off en todas las tablas actuales del esquema
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'emprendedores'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY;', r.schemaname, r.tablename);
    RAISE NOTICE 'RLS deshabilitado en %.%', r.schemaname, r.tablename;
  END LOOP;
END $$;

-- 2) Acceso anon/authenticated/service_role a TODO lo existente ahora mismo
--    (tablas, vistas, secuencias, funciones) en el esquema.
GRANT USAGE ON SCHEMA emprendedores TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA emprendedores TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA emprendedores TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA emprendedores TO anon, authenticated, service_role;

-- 3) Mismo acceso automatico para tablas/secuencias/funciones que se
--    creen en el futuro (sin tener que re-correr este script).
ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
