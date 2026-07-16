-- Migración 021: solicitudes de cambio de precio por emprendedores
--
-- Permite que los emprendedores soliciten un cambio en el precio de venta
-- sugerido de sus productos. Sigue el mismo patrón de aprobación que
-- productos_pendientes e ingresos_inventario_pendientes.
--
-- INSTRUCCIONES: ejecutar en el SQL Editor de Supabase antes del deploy.

CREATE TABLE IF NOT EXISTS emprendedores.cambios_precio_pendientes (
  id                BIGSERIAL PRIMARY KEY,
  emprendimiento_id INT  NOT NULL REFERENCES emprendedores.emprendimientos(id),
  razon_social_id   INT  NOT NULL,
  producto_id       INT  NOT NULL REFERENCES emprendedores.productos(id),
  producto_nombre   TEXT NOT NULL,
  codigo_barras     TEXT NOT NULL,
  precio_actual     NUMERIC(12,2) NOT NULL,
  precio_nuevo      NUMERIC(12,2) NOT NULL,
  motivo            TEXT,
  estado            TEXT NOT NULL DEFAULT 'pendiente',
  motivo_rechazo    TEXT,
  usuario           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);
