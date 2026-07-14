-- ============================================================================
-- Migracion 022: Liquidaciones semanales, conteo de caja, venta a credito y envios
-- ============================================================================
-- Idempotente: seguro de re-ejecutar.
--
-- 1. ventas_encabezado: es_credito, es_envio, valor_flete
--    - es_credito: venta con valor 0 que descuenta inventario (sin ingreso).
--    - es_envio + valor_flete: el flete NO se suma a la factura del cliente;
--      se descuenta de la liquidacion semanal del emprendedor.
-- 2. liquidaciones_semanales: pago semanal (lunes-domingo) a cada emprendedor.
--    monto_ventas/monto_fletes/monto_neto son snapshot al generar/recalcular;
--    al marcar 'pagado' el snapshot queda congelado (historico contractual).
-- 3. caja_chica_conteos: detalle del conteo fisico de billetes (Lempiras)
--    en apertura y cierre de cada sesion de caja.
-- 4. Modulo "Liquidaciones" para permisos.
-- ============================================================================

-- ---------- 1. Columnas nuevas en ventas_encabezado ----------
ALTER TABLE emprendedores.ventas_encabezado
  ADD COLUMN IF NOT EXISTS es_credito  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE emprendedores.ventas_encabezado
  ADD COLUMN IF NOT EXISTS es_envio    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE emprendedores.ventas_encabezado
  ADD COLUMN IF NOT EXISTS valor_flete NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ---------- 2. Liquidaciones semanales ----------
CREATE TABLE IF NOT EXISTS emprendedores.liquidaciones_semanales (
  id                SERIAL PRIMARY KEY,
  razon_social_id   INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  emprendimiento_id INTEGER NOT NULL REFERENCES emprendedores.emprendimientos(id) ON DELETE CASCADE,
  fecha_inicio      DATE NOT NULL,   -- lunes
  fecha_fin         DATE NOT NULL,   -- domingo
  monto_ventas      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- snapshot ventas de la semana
  monto_fletes      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- deduccion por fletes (positivo)
  monto_neto        NUMERIC(14,2) NOT NULL DEFAULT 0,  -- ventas - fletes (puede ser negativo)
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado')),
  fecha_pago        TIMESTAMPTZ,
  comprobante_url   TEXT,
  notas             TEXT,
  usuario           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (emprendimiento_id, fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_emp_liquidaciones_periodo
  ON emprendedores.liquidaciones_semanales(razon_social_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_emp_liquidaciones_emprendimiento
  ON emprendedores.liquidaciones_semanales(emprendimiento_id, fecha_inicio DESC);

-- ---------- 3. Conteos de caja (billetes) ----------
CREATE TABLE IF NOT EXISTS emprendedores.caja_chica_conteos (
  id              SERIAL PRIMARY KEY,
  razon_social_id INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  sesion_id       INTEGER NOT NULL REFERENCES emprendedores.caja_chica_sesiones(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('Apertura','Cierre')),
  detalle         JSONB NOT NULL,          -- {"500": 3, "200": 1, ..., "1": 10}
  total           NUMERIC(14,2) NOT NULL,  -- suma denominacion x cantidad
  usuario         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sesion_id, tipo)
);

-- ---------- 4. Modulo Liquidaciones ----------
INSERT INTO emprendedores.modulos (nombre, orden)
SELECT 'Liquidaciones', 23
WHERE NOT EXISTS (SELECT 1 FROM emprendedores.modulos WHERE nombre = 'Liquidaciones');

-- Otorgar el modulo nuevo a todos los usuarios con rol Admin
INSERT INTO emprendedores.permisos_usuarios (usuario_id, modulo_id, puede_ver)
SELECT u.id, m.id, TRUE
FROM emprendedores.usuarios u
CROSS JOIN emprendedores.modulos m
WHERE m.nombre = 'Liquidaciones'
  AND lower(coalesce(u.rol, '')) = 'admin'
ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET puede_ver = TRUE;
