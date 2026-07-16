-- Migración 019: campo metodo_pago denormalizado en ventas_encabezado
--
-- Almacena el método de pago resumen directamente en cada venta para
-- evitar la segunda query a ventas_pagos_detalle en historial y portal
-- emprendedor, y para que el cierre diario calcule efectivo desde
-- ventas_pagos_detalle (fuente confiable) en lugar de caja_chica_movimientos.
--
-- Valores posibles:
--   'Efectivo'  → venta pagada íntegra en efectivo
--   'Banco'     → venta pagada íntegra por transferencia bancaria
--   'Link_Pago' → venta pagada íntegra por link de pago
--   'Credito'   → venta a crédito
--   'Mixto'     → venta pagada con múltiples métodos
--   'Otro'      → método no clasificado
--   NULL        → registros anteriores a esta migración sin filas en
--                 ventas_pagos_detalle (comportamiento correcto)
--
-- INSTRUCCIONES: ejecutar en el SQL Editor de Supabase.

ALTER TABLE emprendedores.ventas_encabezado
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT
  CHECK (metodo_pago IN ('Efectivo','Banco','Link_Pago','Credito','Mixto','Otro'));

-- Backfill histórico: calcular desde ventas_pagos_detalle existentes.
-- Ventas sin filas en ventas_pagos_detalle quedan con NULL (correcto).
UPDATE emprendedores.ventas_encabezado ve
SET metodo_pago = (
  SELECT CASE WHEN COUNT(DISTINCT p.metodo_pago) > 1 THEN 'Mixto'
              ELSE MAX(p.metodo_pago)
         END
  FROM emprendedores.ventas_pagos_detalle p
  WHERE p.venta_id = ve.id
)
WHERE ve.metodo_pago IS NULL
  AND EXISTS (SELECT 1 FROM emprendedores.ventas_pagos_detalle WHERE venta_id = ve.id);

-- Índice para filtros en historial y cierre diario
CREATE INDEX IF NOT EXISTS idx_ventas_enc_metodo_pago
  ON emprendedores.ventas_encabezado(razon_social_id, metodo_pago);
