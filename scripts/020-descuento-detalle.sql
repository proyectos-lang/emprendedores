-- Migración 020: descuento por ítem en ventas_detalle
--
-- Agrega la columna descuentodetalle para almacenar el porcentaje de descuento
-- aplicado a cada línea de detalle de venta de forma independiente.
-- Valores válidos: 0-100 (porcentaje). DEFAULT 0 = sin descuento.
--
-- Registros históricos quedan con descuentodetalle = 0; el descuento
-- global del encabezado (ventas_encabezado.descuento) sigue siendo
-- el fallback de presentación para esos registros.
--
-- INSTRUCCIONES: ejecutar en el SQL Editor de Supabase.

ALTER TABLE emprendedores.ventas_detalle
  ADD COLUMN IF NOT EXISTS descuentodetalle NUMERIC(5,2) DEFAULT 0;
