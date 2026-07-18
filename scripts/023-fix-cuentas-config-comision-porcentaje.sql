-- ============================================================================
-- Migracion 023: renombrar cuentas_config.porcentaje_comision -> comision_porcentaje
-- ============================================================================
-- Causa del bug reportado: "could not find the comision_porcentaje of
-- cuentas_config". El script de esquema (scripts/emprendedores-esquema-
-- completo.sql) creo la columna como `porcentaje_comision`, siguiendo el
-- nombre documentado en SUPABASE_SCHEMA.md — pero ese doc estaba desfasado
-- respecto al codigo real: `lib/services/cuentas.ts` siempre leyo/escribio
-- la columna `comision_porcentaje` (con un alias de PostgREST hacia
-- `porcentaje_comision` solo para el resto del frontend). Por eso crear una
-- cuenta con % de comision fallaba: PostgREST no encontraba esa columna.
--
-- Ya corregido en el script de esquema y en SUPABASE_SCHEMA.md para que
-- coincidan con el codigo. Este script arregla la tabla que ya se creo en
-- Supabase con el nombre incorrecto.
--
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'emprendedores'
      AND table_name = 'cuentas_config'
      AND column_name = 'porcentaje_comision'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'emprendedores'
      AND table_name = 'cuentas_config'
      AND column_name = 'comision_porcentaje'
  ) THEN
    ALTER TABLE emprendedores.cuentas_config
      RENAME COLUMN porcentaje_comision TO comision_porcentaje;
  END IF;
END $$;

-- Si despues de correr esto el error persiste, es que PostgREST tiene
-- cacheado el esquema viejo. Fuerza un reload (o usa el boton "Reload
-- schema cache" en Dashboard -> Database -> API):
NOTIFY pgrst, 'reload schema';
