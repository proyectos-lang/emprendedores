-- ============================================================================
-- Migracion 024: agregar columnas faltantes en conceptos_gastos y gastos
-- ============================================================================
-- Causa del bug reportado: "could not find the usuario column of
-- conceptos_gastos". Mismo patron que la migracion 023 (cuentas_config):
-- el script de esquema quedo incompleto respecto al codigo real.
--
-- `lib/services/gastos.ts` inyecta `...stamp` (razon_social_id + usuario)
-- en TODO insert, como el resto de la app (patron de auditoria) — pero
-- `conceptos_gastos` y `gastos` se crearon sin columna `usuario`.
-- Ademas `gastos` tampoco tenia `proveedor_id` (FK real que usa el codigo
-- via join `proveedores:proveedor_id` en getGastos/getCuentasPorPagar);
-- solo existia el campo legado `proveedor_nombre`, que el codigo actual
-- no escribe.
--
-- Ya corregido en el script de esquema y en SUPABASE_SCHEMA.md. Este
-- script arregla las tablas que ya se crearon en Supabase.
--
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

ALTER TABLE emprendedores.conceptos_gastos
  ADD COLUMN IF NOT EXISTS usuario TEXT;

ALTER TABLE emprendedores.gastos
  ADD COLUMN IF NOT EXISTS usuario TEXT;

ALTER TABLE emprendedores.gastos
  ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES emprendedores.proveedores(id) ON DELETE SET NULL;

-- Si despues de correr esto el error persiste, fuerza un reload del cache
-- de esquema de PostgREST (o usa el boton "Reload schema cache" en
-- Dashboard -> Database -> API):
NOTIFY pgrst, 'reload schema';
