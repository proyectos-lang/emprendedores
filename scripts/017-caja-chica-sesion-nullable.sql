-- Migración 017: sesion_id nullable en caja_chica_movimientos
--
-- Permite registrar movimientos de ingresos (ventas en efectivo, ingresos
-- manuales) en caja_chica_movimientos aunque no haya una sesión de caja
-- abierta. Salidas y transferencias siguen requiriendo sesión activa
-- (controlado en la capa de aplicación).
--
-- INSTRUCCIONES: ejecutar este script en el SQL Editor de Supabase.

ALTER TABLE emprendedores.caja_chica_movimientos
  ALTER COLUMN sesion_id DROP NOT NULL;
