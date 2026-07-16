-- Migración 018: campo monto_bruto en cuenta_movimientos
--
-- Almacena el valor bruto (antes de descontar la comisión bancaria) en cada
-- movimiento de ingreso. Permite que la tirilla del cierre diario muestre
-- exactamente lo que pagó el cliente, sin necesitar ventas_pagos_detalle.
--
-- INSTRUCCIONES: ejecutar este script en el SQL Editor de Supabase.

ALTER TABLE emprendedores.cuenta_movimientos
  ADD COLUMN IF NOT EXISTS monto_bruto NUMERIC(14,2);
