-- ============================================================================
-- Migracion 025: comentario por linea en ventas_detalle
-- ============================================================================
-- Permite que el vendedor escriba una nota libre en cada linea de producto
-- al registrar una venta (ej. "cliente pidio empaque de regalo", "producto
-- con detalle en la costura"). El comentario se muestra tanto en el
-- historial de ventas del admin como en el portal del emprendedor dueño
-- del producto, para que tenga contexto de como se vendio su articulo.
--
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

ALTER TABLE emprendedores.ventas_detalle
  ADD COLUMN IF NOT EXISTS comentario TEXT;

-- Si despues de correr esto el error persiste, fuerza un reload del cache
-- de esquema de PostgREST (o usa el boton "Reload schema cache" en
-- Dashboard -> Database -> API):
NOTIFY pgrst, 'reload schema';
