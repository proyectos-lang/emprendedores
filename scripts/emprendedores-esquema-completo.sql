-- ================================================================
-- ESQUEMA COMPLETO "emprendedores" — EasyCount / Portal de Emprendedores
-- ================================================================
-- Genera TODAS las tablas y vistas necesarias para operar la aplicacion
-- en un esquema nuevo `emprendedores`, dentro del MISMO proyecto de
-- Supabase (mismas variables de entorno NEXT_PUBLIC_SUPABASE_URL /
-- NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY).
--
-- Este script corrige y completa el de SUPABASE_SCHEMA.md (seccion 10),
-- que quedo desactualizado respecto al codigo real de lib/services/*:
--   - Agrega `pagos_alquiler_emprendimientos` (usado por pagos-alquiler.ts,
--     no existia en el doc).
--   - Agrega `compras_detalle` (usado por compras.ts, no existia en el doc).
--   - Corrige columnas de `compras_encabezado` para que coincidan con la
--     interfaz real CompraEncabezado (moneda, tasa_cambio, costos_importacion,
--     impuestos_compra, otros_costos, total_compra_local, etc.) — el doc
--     tenia una version antigua con muchas menos columnas.
--   - Agrega vista `vista_stock_por_localizacion` (existe en el codigo,
--     estaba marcada como "inferida" en el doc pero faltaba en el script).
--   - Agrega vista `vista_estado_resultados_mensual` (usada por
--     estado-resultados.ts, faltaba por completo).
--   - Agrega los GRANT/ALTER DEFAULT PRIVILEGES necesarios para que
--     PostgREST pueda leer/escribir en un esquema custom (paso que Supabase
--     no hace solo al exponer el esquema en el dashboard).
--   - El seed de `modulos` usa los 22 modulos reales de
--     lib/constants/modulos.ts (el doc tenia una lista vieja de 10).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor, de una sola vez, en orden.
-- ================================================================


-- ============================================================
-- PASO 0: Crear esquema + permisos para PostgREST
-- ============================================================
CREATE SCHEMA IF NOT EXISTS emprendedores;

-- IMPORTANTE (paso manual, no se puede hacer por SQL):
-- Dashboard → Database → API Settings → "Exposed schemas" → agregar "emprendedores"

-- Sin estos GRANT, PostgREST devuelve "permission denied for schema emprendedores"
-- aunque el esquema ya este expuesto en el dashboard (a diferencia de `public`,
-- un esquema custom no hereda privilegios por defecto).
GRANT USAGE ON SCHEMA emprendedores TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA emprendedores TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA emprendedores TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA emprendedores TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA emprendedores GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- Extension necesaria para crypt() al crear el usuario admin en auth.users (Paso 15)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- PASO 1: Storage (buckets — no son especificos de un esquema Postgres)
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('productos', 'productos', true)
  ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read logos') THEN
    CREATE POLICY "Public read logos" ON storage.objects FOR SELECT USING (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public write logos') THEN
    CREATE POLICY "Public write logos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public update logos') THEN
    CREATE POLICY "Public update logos" ON storage.objects FOR UPDATE USING (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public delete logos') THEN
    CREATE POLICY "Public delete logos" ON storage.objects FOR DELETE USING (bucket_id = 'logos');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read productos') THEN
    CREATE POLICY "Public read productos" ON storage.objects FOR SELECT USING (bucket_id = 'productos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public write productos') THEN
    CREATE POLICY "Public write productos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'productos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public update productos') THEN
    CREATE POLICY "Public update productos" ON storage.objects FOR UPDATE USING (bucket_id = 'productos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public delete productos') THEN
    CREATE POLICY "Public delete productos" ON storage.objects FOR DELETE USING (bucket_id = 'productos');
  END IF;
END $$;


-- ============================================================
-- PASO 2: Tenant raiz
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.razon_social (
  id                SERIAL PRIMARY KEY,
  nombre_empresa    TEXT NOT NULL,
  nombre_comercial  TEXT NOT NULL,
  documento         TEXT NOT NULL,
  direccion         TEXT NOT NULL,
  telefono          TEXT NOT NULL,
  correo            TEXT NOT NULL,
  logo_url          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PASO 3: Modulos (22 modulos reales de lib/constants/modulos.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.modulos (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  orden       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO emprendedores.modulos (nombre, orden) VALUES
  ('Dashboard',                     1),
  ('Dashboard Ventas',              2),
  ('Nueva Venta',                  3),
  ('Historial Ventas',              4),
  ('Historial de Transacciones',    5),
  ('Movimientos Manuales',          6),
  ('Valoracion',                    7),
  ('Estado de Resultados',          8),
  ('Gastos',                        9),
  ('Caja Chica',                   10),
  ('Cierre Diario',                11),
  ('Razon Social',                 12),
  ('Usuarios y Permisos',          13),
  ('Productos',                    14),
  ('Almacenes',                    15),
  ('Clientes',                     16),
  ('Proveedores',                  17),
  ('Cuentas Bancarias',            18),
  ('Preview PDFs',                 19),
  ('Emprendimientos',              20),
  ('Pagos de Alquiler',            21),
  ('Aprobaciones',                 22),
  ('Liquidaciones',                23)
ON CONFLICT (nombre) DO NOTHING;


-- ============================================================
-- PASO 4: Usuarios admin (Supabase Auth) + permisos
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.usuarios (
  id              UUID PRIMARY KEY,           -- = auth.users.id
  email           TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE SET NULL,
  activo          BOOLEAN DEFAULT true,
  rol             TEXT DEFAULT 'Usuario',
  auth_user_id    UUID UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emprendedores_usuarios_auth_user_id ON emprendedores.usuarios(auth_user_id);

CREATE TABLE IF NOT EXISTS emprendedores.permisos_usuarios (
  id          SERIAL PRIMARY KEY,
  usuario_id  UUID NOT NULL REFERENCES emprendedores.usuarios(id) ON DELETE CASCADE,
  modulo_id   INTEGER NOT NULL REFERENCES emprendedores.modulos(id) ON DELETE CASCADE,
  puede_ver   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(usuario_id, modulo_id)
);


-- ============================================================
-- PASO 5: Catalogos
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.marcas (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.categorias (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.subcategorias (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  categoria_id    INTEGER NOT NULL REFERENCES emprendedores.categorias(id) ON DELETE CASCADE,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategorias_tenant_cat_nombre
  ON emprendedores.subcategorias(razon_social_id, categoria_id, lower(nombre));

CREATE TABLE IF NOT EXISTS emprendedores.almacenes (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  ubicacion       TEXT NOT NULL,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.localizaciones (
  id              SERIAL PRIMARY KEY,
  almacen_id      INTEGER NOT NULL REFERENCES emprendedores.almacenes(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.clientes (
  id               SERIAL PRIMARY KEY,
  nombre           TEXT NOT NULL,
  rtn              TEXT,
  direccion        TEXT,
  telefono         TEXT,
  fecha_nacimiento DATE,
  razon_social_id  INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario          TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
-- Nota: to_char() esta marcada STABLE (no IMMUTABLE) en Postgres, por lo que
-- no puede usarse en una expresion de indice (error 42P17). Se reemplaza por
-- EXTRACT(), que si es IMMUTABLE para columnas DATE, con el mismo proposito
-- (acelerar el filtrado de cumpleanos por mes/dia).
CREATE INDEX IF NOT EXISTS idx_emp_clientes_cumple_mmdd
  ON emprendedores.clientes (EXTRACT(MONTH FROM fecha_nacimiento), EXTRACT(DAY FROM fecha_nacimiento))
  WHERE fecha_nacimiento IS NOT NULL;

CREATE TABLE IF NOT EXISTS emprendedores.proveedores (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  rtn             TEXT NOT NULL,
  contacto        TEXT NOT NULL,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- PASO 6: Emprendimientos (portal de emprendedores)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.emprendimientos (
  id                      SERIAL PRIMARY KEY,
  razon_social_id         INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  nombre                  TEXT NOT NULL,
  descripcion             TEXT,
  email_contacto          TEXT,
  telefono                TEXT,
  zona                    TEXT,
  valor_alquiler_mensual  NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  usuario                 TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.emprendedores_usuarios (
  id                SERIAL PRIMARY KEY,
  emprendimiento_id INTEGER NOT NULL REFERENCES emprendedores.emprendimientos(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  usuario           TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  activo            BOOLEAN DEFAULT true,
  session_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- PASO 7: Productos
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.productos (
  id                     SERIAL PRIMARY KEY,
  nombre                 TEXT NOT NULL,
  codigo_barras          TEXT,
  precio_venta_sugerido  NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_promedio         NUMERIC(12,2) DEFAULT 0,
  stock_total            NUMERIC(12,2) DEFAULT 0,
  foto_url               TEXT,
  marca_id               INTEGER REFERENCES emprendedores.marcas(id) ON DELETE SET NULL,
  categoria_id           INTEGER REFERENCES emprendedores.categorias(id) ON DELETE SET NULL,
  subcategoria_id        INTEGER REFERENCES emprendedores.subcategorias(id) ON DELETE SET NULL,
  emprendimiento_id      INTEGER REFERENCES emprendedores.emprendimientos(id) ON DELETE SET NULL,
  razon_social_id        INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario                TEXT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emp_productos_razon_social   ON emprendedores.productos(razon_social_id);
CREATE INDEX IF NOT EXISTS idx_emp_productos_emprendimiento ON emprendedores.productos(emprendimiento_id);


-- ============================================================
-- PASO 8: Flujo de aprobacion (emprendedores -> admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.productos_pendientes (
  id                      SERIAL PRIMARY KEY,
  emprendimiento_id       INTEGER REFERENCES emprendedores.emprendimientos(id),
  razon_social_id         INTEGER NOT NULL,
  nombre                  TEXT NOT NULL,
  codigo_barras           TEXT NOT NULL,
  precio_venta_sugerido   NUMERIC(12,2) NOT NULL,
  precio_costo            NUMERIC(12,2),
  cantidad_inicial        INTEGER DEFAULT 0,
  foto_url                TEXT,
  marca_nombre            TEXT,
  categoria_nombre        TEXT,
  subcategoria_nombre     TEXT,
  estado                  TEXT NOT NULL DEFAULT 'pendiente',
  motivo_rechazo          TEXT,
  usuario                 TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS emprendedores.ingresos_inventario_pendientes (
  id                SERIAL PRIMARY KEY,
  emprendimiento_id INTEGER REFERENCES emprendedores.emprendimientos(id),
  razon_social_id   INTEGER NOT NULL,
  producto_id       INTEGER REFERENCES emprendedores.productos(id),
  almacen_id        INTEGER REFERENCES emprendedores.almacenes(id),
  cantidad          NUMERIC(12,2) NOT NULL,
  costo_unitario    NUMERIC(12,2),
  estado            TEXT NOT NULL DEFAULT 'pendiente',
  motivo_rechazo    TEXT,
  usuario           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS emprendedores.cambios_precio_pendientes (
  id                BIGSERIAL PRIMARY KEY,
  emprendimiento_id INTEGER NOT NULL REFERENCES emprendedores.emprendimientos(id),
  razon_social_id   INTEGER NOT NULL,
  producto_id       INTEGER NOT NULL REFERENCES emprendedores.productos(id),
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


-- ============================================================
-- PASO 9: Tesoreria
-- ============================================================
-- Nota: la columna se llama `comision_porcentaje` (no `porcentaje_comision`)
-- a proposito: asi la espera lib/services/cuentas.ts, que la lee/escribe
-- via ese nombre exacto y solo la expone al resto de la app con el alias
-- de PostgREST `porcentaje_comision:comision_porcentaje` en los SELECT.
CREATE TABLE IF NOT EXISTS emprendedores.cuentas_config (
  id                   SERIAL PRIMARY KEY,
  razon_social_id      INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  nombre               TEXT NOT NULL,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('Banco','Link_Pago','Otro')),
  comision_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 0
                       CHECK (comision_porcentaje >= 0 AND comision_porcentaje <= 100),
  activo               BOOLEAN NOT NULL DEFAULT true,
  saldo                NUMERIC(14,2) NOT NULL DEFAULT 0,
  usuario              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.caja_chica_sesiones (
  id                    SERIAL PRIMARY KEY,
  razon_social_id       INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  fecha_apertura        TIMESTAMPTZ NOT NULL DEFAULT now(),
  saldo_inicial         NUMERIC(14,2) NOT NULL DEFAULT 0,
  fecha_cierre          TIMESTAMPTZ,
  saldo_final_real      NUMERIC(14,2),
  saldo_final_calculado NUMERIC(14,2),
  diferencia            NUMERIC(14,2),
  estado                TEXT NOT NULL CHECK (estado IN ('Abierta','Cerrada')),
  usuario_apertura      TEXT,
  usuario_cierre        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_caja_sesion_abierta
  ON emprendedores.caja_chica_sesiones(razon_social_id) WHERE estado = 'Abierta';

CREATE TABLE IF NOT EXISTS emprendedores.caja_chica_movimientos (
  id                SERIAL PRIMARY KEY,
  razon_social_id   INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  sesion_id         INTEGER REFERENCES emprendedores.caja_chica_sesiones(id) ON DELETE CASCADE, -- nullable
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo              TEXT NOT NULL CHECK (tipo IN ('Apertura','Ingreso_Manual','Ingreso_Venta','Salida','Transferencia_Banco','Cierre')),
  monto             NUMERIC(14,2) NOT NULL,
  concepto          TEXT,
  ref_tipo          TEXT,
  ref_id            INTEGER,
  cuenta_destino_id INTEGER REFERENCES emprendedores.cuentas_config(id),
  saldo_resultante  NUMERIC(14,2) NOT NULL,
  usuario           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.cuenta_movimientos (
  id               SERIAL PRIMARY KEY,
  razon_social_id  INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  cuenta_id        INTEGER NOT NULL REFERENCES emprendedores.cuentas_config(id) ON DELETE CASCADE,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo             TEXT NOT NULL CHECK (tipo IN ('Ingreso','Egreso')),
  monto            NUMERIC(14,2) NOT NULL,
  monto_bruto      NUMERIC(14,2),
  concepto         TEXT,
  ref_tipo         TEXT,
  ref_id           INTEGER,
  saldo_resultante NUMERIC(14,2) NOT NULL,
  usuario          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PASO 10: Ventas
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.ventas_encabezado (
  id                  SERIAL PRIMARY KEY,
  numero_factura      TEXT NOT NULL,
  cliente_id          INTEGER REFERENCES emprendedores.clientes(id),
  almacen_id          INTEGER REFERENCES emprendedores.almacenes(id),
  fecha_venta         TIMESTAMPTZ DEFAULT now(),
  aplica_impuesto     BOOLEAN DEFAULT false,
  porcentaje_impuesto NUMERIC(5,2) DEFAULT 15,
  descuento           NUMERIC(5,2) DEFAULT 0,
  subtotal            NUMERIC(14,2) DEFAULT 0,
  impuesto_total      NUMERIC(14,2) DEFAULT 0,
  total_venta         NUMERIC(14,2) DEFAULT 0,
  estado_pago         TEXT DEFAULT 'Pendiente' CHECK (estado_pago IN ('Pendiente','Parcial','Pagado')),
  valorpago           NUMERIC(14,2) NOT NULL DEFAULT 0,
  comisionbanc        NUMERIC(5,4),
  metodo_pago         TEXT CHECK (metodo_pago IN ('Efectivo','Banco','Link_Pago','Credito','Mixto','Otro')),
  es_credito          BOOLEAN NOT NULL DEFAULT false,   -- migracion 022: venta valor 0 que descuenta stock
  es_envio            BOOLEAN NOT NULL DEFAULT false,   -- migracion 022
  valor_flete         NUMERIC(14,2) NOT NULL DEFAULT 0, -- migracion 022: se descuenta al emprendedor, no al cliente
  razon_social_id     INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_ventas_enc_razon_social ON emprendedores.ventas_encabezado(razon_social_id);
CREATE INDEX IF NOT EXISTS idx_emp_ventas_enc_fecha ON emprendedores.ventas_encabezado(fecha_venta DESC);

CREATE TABLE IF NOT EXISTS emprendedores.ventas_detalle (
  id                       SERIAL PRIMARY KEY,
  venta_id                 INTEGER NOT NULL REFERENCES emprendedores.ventas_encabezado(id) ON DELETE CASCADE,
  producto_id              INTEGER REFERENCES emprendedores.productos(id),
  cantidad                 NUMERIC(10,2) NOT NULL,
  precio_unitario          NUMERIC(14,4) NOT NULL,
  costo_promedio_momento   NUMERIC(14,4) NOT NULL DEFAULT 0,
  utilidad_linea           NUMERIC(14,4) NOT NULL DEFAULT 0,
  descuentodetalle         NUMERIC(5,2) DEFAULT 0,
  razon_social_id          INTEGER REFERENCES emprendedores.razon_social(id),
  usuario                  TEXT
);

CREATE TABLE IF NOT EXISTS emprendedores.ventas_pagos_detalle (
  id                   SERIAL PRIMARY KEY,
  razon_social_id      INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  venta_id             INTEGER NOT NULL REFERENCES emprendedores.ventas_encabezado(id) ON DELETE CASCADE,
  metodo_pago          TEXT NOT NULL CHECK (metodo_pago IN ('Efectivo','Banco','Link_Pago','Credito','Otro')),
  cuenta_id            INTEGER REFERENCES emprendedores.cuentas_config(id),
  monto_bruto          NUMERIC(14,2) NOT NULL CHECK (monto_bruto >= 0),
  porcentaje_comision  NUMERIC(5,2) NOT NULL DEFAULT 0,
  monto_neto           NUMERIC(14,2) NOT NULL,
  usuario              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.pagos_ventas (
  id              SERIAL PRIMARY KEY,
  venta_id        INTEGER REFERENCES emprendedores.ventas_encabezado(id),
  fecha_pago      TIMESTAMPTZ DEFAULT now(),
  monto           NUMERIC(14,2) NOT NULL,
  metodo_pago     TEXT NOT NULL,
  razon_social_id INTEGER,
  usuario         TEXT
);


-- ============================================================
-- PASO 11: Compras (columnas corregidas segun CompraEncabezado/
-- CompraDetalle reales en lib/services/compras.ts — el script de
-- SUPABASE_SCHEMA.md tenia una version antigua e incompleta)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.compras_encabezado (
  id                  SERIAL PRIMARY KEY,
  proveedor_id        INTEGER REFERENCES emprendedores.proveedores(id),
  fecha_orden         TIMESTAMPTZ DEFAULT now(),
  fecha_tentativa     DATE,
  moneda              TEXT NOT NULL DEFAULT 'LPS' CHECK (moneda IN ('LPS','USD')),
  tasa_cambio         NUMERIC(12,4) NOT NULL DEFAULT 1,
  costos_importacion  NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuestos_compra    NUMERIC(12,2) NOT NULL DEFAULT 0,
  otros_costos        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_compra_local  NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal            NUMERIC(14,2) DEFAULT 0,
  total               NUMERIC(14,2) DEFAULT 0,
  estado              TEXT DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Recibida','Cancelada')),
  razon_social_id     INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.compras_detalle (
  id                              SERIAL PRIMARY KEY,
  compra_id                       INTEGER NOT NULL REFERENCES emprendedores.compras_encabezado(id) ON DELETE CASCADE,
  producto_id                     INTEGER REFERENCES emprendedores.productos(id),
  cantidad                        NUMERIC(10,2) NOT NULL,
  cantidad_recibida               NUMERIC(10,2) DEFAULT 0,
  costo_unitario_moneda_origen    NUMERIC(14,4) NOT NULL,
  costo_final_local               NUMERIC(14,4),
  razon_social_id                 INTEGER REFERENCES emprendedores.razon_social(id),
  created_at                      TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- PASO 12: Inventario (kardex)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.transacciones_inventario (
  id                      SERIAL PRIMARY KEY,
  producto_id             INTEGER REFERENCES emprendedores.productos(id),
  almacen_id              INTEGER REFERENCES emprendedores.almacenes(id),
  localizacion_id         INTEGER REFERENCES emprendedores.localizaciones(id),
  tipo_movimiento         TEXT NOT NULL,
  cantidad                NUMERIC(12,2) NOT NULL,
  costo_o_precio_unitario NUMERIC(14,4),
  referencia_id           INTEGER,
  razon_social_id         INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario                 TEXT,
  fecha                   TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- PASO 13: Gastos y Cuentas por Pagar
-- ============================================================
-- Nota: `usuario` es obligatorio aqui (y en `gastos`) porque
-- lib/services/gastos.ts inyecta `...stamp` (razon_social_id + usuario) en
-- cada insert, siguiendo el patron de auditoria del resto de la app.
CREATE TABLE IF NOT EXISTS emprendedores.conceptos_gastos (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  categoria_macro VARCHAR(50) NOT NULL CHECK (categoria_macro IN ('Servicios','Publicidad','Nomina','Arriendo','Mantenimiento','Impuestos','Suministros','Otros')),
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Nota: `proveedor_id` es la FK real que usa el codigo (join
-- `proveedores:proveedor_id` en getGastos/getCuentasPorPagar).
-- `proveedor_nombre`/`numero_factura` quedan como columnas legadas sin uso
-- del codigo actual (no se escriben ni se leen), se dejan por compatibilidad.
CREATE TABLE IF NOT EXISTS emprendedores.gastos (
  id                SERIAL PRIMARY KEY,
  concepto_id       INTEGER NOT NULL REFERENCES emprendedores.conceptos_gastos(id) ON DELETE RESTRICT,
  fecha_gasto       DATE NOT NULL,
  monto             DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago       VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('Efectivo','Transferencia','Tarjeta')),
  descripcion       TEXT,
  comprobante_url   TEXT,
  proveedor_id      INTEGER REFERENCES emprendedores.proveedores(id) ON DELETE SET NULL,
  proveedor_nombre  TEXT,
  numero_factura    TEXT,
  fecha_vencimiento DATE,
  monto_pagado      NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado_pago       TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado_pago IN ('Pendiente','Parcial','Pagado')),
  razon_social_id   INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.gastos_pagos_detalle (
  id                    SERIAL PRIMARY KEY,
  razon_social_id       INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  gasto_id              INTEGER NOT NULL REFERENCES emprendedores.gastos(id) ON DELETE CASCADE,
  fecha_pago            TIMESTAMPTZ NOT NULL DEFAULT now(),
  monto                 NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  metodo_pago           TEXT NOT NULL CHECK (metodo_pago IN ('Efectivo','Banco','Otro')),
  cuenta_id             INTEGER REFERENCES emprendedores.cuentas_config(id),
  caja_movimiento_id    INTEGER,
  cuenta_movimiento_id  INTEGER,
  concepto              TEXT,
  usuario               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PASO 14: Pagos de alquiler (Concept Store — NUEVA, faltaba en el doc)
-- Columnas segun lib/services/pagos-alquiler.ts
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.pagos_alquiler_emprendimientos (
  id                SERIAL PRIMARY KEY,
  emprendimiento_id INTEGER NOT NULL REFERENCES emprendedores.emprendimientos(id) ON DELETE CASCADE,
  razon_social_id   INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  anio              INTEGER NOT NULL,
  mes               INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto             NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_pago        TIMESTAMPTZ,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado')),
  notas             TEXT,
  usuario           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ,
  UNIQUE (emprendimiento_id, anio, mes)
);
CREATE INDEX IF NOT EXISTS idx_emp_pagos_alquiler_periodo ON emprendedores.pagos_alquiler_emprendimientos(razon_social_id, anio, mes);


-- ============================================================
-- PASO 14b: Liquidaciones semanales a emprendedores (migracion 022)
-- Semana lunes-domingo; snapshot de montos al generar/recalcular;
-- congelado al marcar pagado (comprobante_url = soporte del pago).
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.liquidaciones_semanales (
  id                SERIAL PRIMARY KEY,
  razon_social_id   INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  emprendimiento_id INTEGER NOT NULL REFERENCES emprendedores.emprendimientos(id) ON DELETE CASCADE,
  fecha_inicio      DATE NOT NULL,   -- lunes
  fecha_fin         DATE NOT NULL,   -- domingo
  monto_ventas      NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_fletes      NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_neto        NUMERIC(14,2) NOT NULL DEFAULT 0,
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


-- ============================================================
-- PASO 14c: Conteos fisicos de billetes en caja (migracion 022)
-- ============================================================
CREATE TABLE IF NOT EXISTS emprendedores.caja_chica_conteos (
  id              SERIAL PRIMARY KEY,
  razon_social_id INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  sesion_id       INTEGER NOT NULL REFERENCES emprendedores.caja_chica_sesiones(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('Apertura','Cierre')),
  detalle         JSONB NOT NULL,          -- {"500": 3, "200": 1, ...}
  total           NUMERIC(14,2) NOT NULL,
  usuario         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sesion_id, tipo)
);


-- ============================================================
-- PASO 15: Vistas
-- ============================================================

CREATE OR REPLACE VIEW emprendedores.vista_cierre_diario AS
WITH ventas_dia AS (
  SELECT
    v.razon_social_id,
    (v.fecha_venta AT TIME ZONE 'UTC')::date AS fecha,
    COUNT(*)::int                             AS cantidad_tickets,
    COALESCE(SUM(v.total_venta), 0)           AS total_ventas
  FROM emprendedores.ventas_encabezado v
  GROUP BY v.razon_social_id, (v.fecha_venta AT TIME ZONE 'UTC')::date
),
pagos_dia AS (
  SELECT
    p.razon_social_id,
    (v.fecha_venta AT TIME ZONE 'UTC')::date AS fecha,
    COALESCE(SUM(CASE WHEN p.metodo_pago = 'Efectivo' THEN p.monto_bruto ELSE 0 END), 0)             AS efectivo_bruto,
    COALESCE(SUM(CASE WHEN p.metodo_pago IN ('Banco','Link_Pago') THEN p.monto_bruto ELSE 0 END), 0) AS banco_bruto,
    COALESCE(SUM(CASE WHEN p.metodo_pago IN ('Banco','Link_Pago') THEN p.monto_neto  ELSE 0 END), 0) AS banco_neto,
    COALESCE(SUM(CASE WHEN p.metodo_pago = 'Credito' THEN p.monto_bruto ELSE 0 END), 0)              AS credito_total,
    COALESCE(SUM(p.monto_bruto - p.monto_neto), 0)                                                   AS comisiones_total
  FROM emprendedores.ventas_pagos_detalle p
  JOIN emprendedores.ventas_encabezado v ON v.id = p.venta_id
  GROUP BY p.razon_social_id, (v.fecha_venta AT TIME ZONE 'UTC')::date
)
SELECT
  vd.razon_social_id, vd.fecha, vd.cantidad_tickets, vd.total_ventas,
  COALESCE(pd.efectivo_bruto, 0)   AS ingresos_efectivo,
  COALESCE(pd.banco_bruto, 0)      AS ingresos_banco_bruto,
  COALESCE(pd.banco_neto, 0)       AS ingresos_banco_neto,
  COALESCE(pd.credito_total, 0)    AS credito_total,
  COALESCE(pd.comisiones_total, 0) AS comisiones_total
FROM ventas_dia vd
LEFT JOIN pagos_dia pd ON pd.razon_social_id = vd.razon_social_id AND pd.fecha = vd.fecha;

-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW emprendedores.vista_cuentas_por_pagar AS
SELECT
  g.id, g.razon_social_id, g.concepto_id,
  c.nombre AS concepto_nombre, c.categoria_macro,
  g.proveedor_nombre, g.numero_factura,
  g.fecha_gasto, g.fecha_vencimiento,
  g.monto, g.monto_pagado,
  (g.monto - g.monto_pagado)::NUMERIC(14,2) AS saldo_pendiente,
  g.estado_pago, g.descripcion, g.comprobante_url,
  CASE WHEN g.fecha_vencimiento IS NULL THEN NULL
       ELSE (CURRENT_DATE - g.fecha_vencimiento)::INTEGER
  END AS dias_vencido,
  g.created_at
FROM emprendedores.gastos g
LEFT JOIN emprendedores.conceptos_gastos c ON c.id = g.concepto_id
WHERE g.estado_pago <> 'Pagado'
ORDER BY
  CASE WHEN g.fecha_vencimiento IS NULL THEN 1 ELSE 0 END,
  g.fecha_vencimiento ASC NULLS LAST,
  g.fecha_gasto ASC;

-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW emprendedores.vista_historico_caja_chica AS
WITH cierre_por_sesion AS (
  SELECT sesion_id, MAX(fecha) AS fecha_cierre
  FROM emprendedores.caja_chica_movimientos
  WHERE tipo = 'Cierre'
  GROUP BY sesion_id
)
SELECT
  s.id AS sesion_id, s.razon_social_id,
  s.fecha_apertura, c.fecha_cierre,
  s.usuario_apertura, s.usuario_cierre, s.estado, s.saldo_inicial,
  COALESCE(SUM(CASE WHEN m.tipo IN ('Ingreso_Manual','Ingreso_Venta') THEN ABS(m.monto) ELSE 0 END), 0) AS total_ingresos,
  COALESCE(SUM(CASE WHEN m.tipo IN ('Salida','Transferencia_Banco')   THEN ABS(m.monto) ELSE 0 END), 0) AS total_egresos,
  s.saldo_final_calculado, s.saldo_final_real, s.diferencia
FROM emprendedores.caja_chica_sesiones s
LEFT JOIN emprendedores.caja_chica_movimientos m
  ON m.sesion_id = s.id AND m.tipo NOT IN ('Apertura','Cierre')
LEFT JOIN cierre_por_sesion c ON c.sesion_id = s.id
GROUP BY s.id, s.razon_social_id, s.fecha_apertura, c.fecha_cierre,
         s.usuario_apertura, s.usuario_cierre, s.estado, s.saldo_inicial,
         s.saldo_final_calculado, s.saldo_final_real, s.diferencia;

-- ----------------------------------------------------------------
-- NUEVA: vista_stock_por_localizacion — usada intensivamente por
-- catalogos.ts, inventario.ts e inventario-pendiente.ts (columnas
-- consultadas: producto_id, almacen_id, emprendimiento_id, stock_actual).
-- Estaba marcada "inferida" en el doc pero NO estaba en el script SQL.

CREATE OR REPLACE VIEW emprendedores.vista_stock_por_localizacion AS
SELECT
  ti.producto_id,
  ti.almacen_id,
  ti.localizacion_id,
  p.emprendimiento_id,
  p.razon_social_id,
  SUM(ti.cantidad) AS stock_actual
FROM emprendedores.transacciones_inventario ti
JOIN emprendedores.productos p ON p.id = ti.producto_id
GROUP BY ti.producto_id, ti.almacen_id, ti.localizacion_id, p.emprendimiento_id, p.razon_social_id;

-- ----------------------------------------------------------------
-- NUEVA: vista_estado_resultados_mensual — usada por estado-resultados.ts.
-- Si falla/no existe, el codigo cae en un fallback calculado on-the-fly,
-- pero sin ella el modulo de Finanzas siempre paga el costo de ese fallback.
-- Nota: la consulta en el codigo NO filtra por razon_social_id (usa
-- .single() sobre anio+mes), asi que se agrega solo por anio/mes —
-- valido en un despliegue de un solo tenant (el modelo tipico del portal).

CREATE OR REPLACE VIEW emprendedores.vista_estado_resultados_mensual AS
SELECT
  EXTRACT(YEAR FROM g.fecha_gasto)::INTEGER  AS anio,
  EXTRACT(MONTH FROM g.fecha_gasto)::INTEGER AS mes,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Servicios'     THEN g.monto ELSE 0 END), 0) AS gastos_servicios,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Publicidad'    THEN g.monto ELSE 0 END), 0) AS gastos_publicidad,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Nomina'        THEN g.monto ELSE 0 END), 0) AS gastos_nomina,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Arriendo'      THEN g.monto ELSE 0 END), 0) AS gastos_arriendo,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Mantenimiento' THEN g.monto ELSE 0 END), 0) AS gastos_mantenimiento,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Impuestos'     THEN g.monto ELSE 0 END), 0) AS gastos_impuestos,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Suministros'   THEN g.monto ELSE 0 END), 0) AS gastos_suministros,
  COALESCE(SUM(CASE WHEN c.categoria_macro = 'Otros'         THEN g.monto ELSE 0 END), 0) AS gastos_otros,
  COALESCE(SUM(g.monto), 0)                                                               AS total_gastos_operativos
FROM emprendedores.gastos g
LEFT JOIN emprendedores.conceptos_gastos c ON c.id = g.concepto_id
GROUP BY EXTRACT(YEAR FROM g.fecha_gasto), EXTRACT(MONTH FROM g.fecha_gasto);


-- ============================================================
-- PASO 16 (opcional/manual): usuario admin inicial
-- ============================================================
-- Ejecutar solo si vas a operar este esquema como un tenant nuevo e
-- independiente (crea admin@easycount.com / admin123 en auth.users y lo
-- enlaza a emprendedores.usuarios con permiso total sobre los modulos).
-- Si ya existe un usuario admin que quieres reutilizar en este esquema,
-- omite este paso y crea el registro manualmente.

DO $$
DECLARE
  v_admin_uid UUID;
  v_existing_id UUID;
  v_rs_id INTEGER;
BEGIN
  SELECT id INTO v_admin_uid FROM auth.users WHERE email = 'admin@easycount.com' LIMIT 1;

  IF v_admin_uid IS NULL THEN
    v_admin_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_admin_uid, 'authenticated', 'authenticated',
      'admin@easycount.com', crypt('admin123', gen_salt('bf')),
      NOW(), NOW(), NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nombre":"Administrador"}'::jsonb,
      '', '', '', ''
    );
  END IF;

  SELECT id INTO v_rs_id FROM emprendedores.razon_social ORDER BY id LIMIT 1;

  SELECT id INTO v_existing_id FROM emprendedores.usuarios WHERE auth_user_id = v_admin_uid;

  IF v_existing_id IS NULL THEN
    INSERT INTO emprendedores.usuarios (id, email, nombre, razon_social_id, auth_user_id, activo)
    VALUES (v_admin_uid, 'admin@easycount.com', 'Administrador', v_rs_id, v_admin_uid, TRUE)
    ON CONFLICT (id) DO NOTHING;
    v_existing_id := v_admin_uid;
  END IF;

  INSERT INTO emprendedores.permisos_usuarios (usuario_id, modulo_id, puede_ver)
  SELECT v_existing_id, m.id, TRUE FROM emprendedores.modulos m
  ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET puede_ver = TRUE;
END $$;

-- ============================================================
-- FIN
-- ============================================================
-- La app ya apunta a este esquema: `db: { schema: 'emprendedores' }` en
-- lib/supabase/client.ts, lib/supabase/server.ts y lib/supabase/admin.ts.
