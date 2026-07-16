# Estructura de Base de Datos Supabase — EasyCount / Emprendedores

> Esquema actual en producción: **`emprendedores`**

---

## Índice

1. [Configuración del esquema](#1-configuración-del-esquema)
2. [Tablas de autenticación y tenant](#2-tablas-de-autenticación-y-tenant)
3. [Catálogos](#3-catálogos)
4. [Portal de Emprendedores](#4-portal-de-emprendedores)
5. [Ventas](#5-ventas)
6. [Tesorería](#6-tesorería)
7. [Gastos y Cuentas por Pagar](#7-gastos-y-cuentas-por-pagar)
8. [Inventario y Compras](#8-inventario-y-compras)
9. [Vistas](#9-vistas)
10. [Script SQL completo para el nuevo esquema](#10-script-sql-completo)
11. [Variables de entorno](#11-variables-de-entorno)
12. [Patrones arquitecturales](#12-patrones-arquitecturales)

---

## 1. Configuración del esquema

En Supabase el esquema por defecto es `public`. Este proyecto utiliza un esquema personalizado. Para habilitarlo:

1. Ir a **Supabase Dashboard → SQL Editor** y ejecutar:
   ```sql
   CREATE SCHEMA IF NOT EXISTS emprendedores;
   ```

2. Habilitar el esquema para PostgREST en **Database → API → Exposed schemas**: agregar `emprendedores`.

3. En la aplicación Next.js los tres clientes especifican el esquema:
   - `lib/supabase/client.ts` → `db: { schema: 'emprendedores' }`
   - `lib/supabase/server.ts` → `db: { schema: 'emprendedores' }`
   - `lib/supabase/admin.ts` → `db: { schema: 'emprendedores' }`

---

## 2. Tablas de autenticación y tenant

### `razon_social`
Empresa / tenant raíz. Cada instalación tiene normalmente **una sola** fila activa.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre_empresa` | `TEXT` | NOT NULL | Razón social legal |
| `nombre_comercial` | `TEXT` | NOT NULL | Nombre con que aparece en UI |
| `documento` | `TEXT` | NOT NULL | RTN / NIT |
| `direccion` | `TEXT` | NOT NULL | |
| `telefono` | `TEXT` | NOT NULL | |
| `correo` | `TEXT` | NOT NULL | |
| `logo_url` | `TEXT` | NULL | URL pública (Supabase Storage bucket `logos`) |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `usuarios`
Usuarios administrativos del sistema (usan Supabase Auth).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `UUID` | PK | Igual a `auth.users.id` |
| `email` | `TEXT` | UNIQUE NOT NULL | |
| `nombre` | `TEXT` | NOT NULL | Nombre para auditoría |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` NULL | Tenant asignado |
| `activo` | `BOOLEAN` | DEFAULT true | |
| `rol` | `TEXT` | DEFAULT 'Usuario' | |
| `auth_user_id` | `UUID` | UNIQUE | Enlace a `auth.users` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | | |

---

### `modulos`
Módulos del sistema para control de permisos.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `TEXT` | UNIQUE NOT NULL | Ej: `'Ventas'`, `'Caja Chica'` |
| `descripcion` | `TEXT` | NULL | |
| `orden` | `INTEGER` | DEFAULT 0 | Orden en el sidebar |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

Valores semilla:
`Dashboard`, `Ventas`, `Compras`, `Inventario`, `Finanzas`, `Configuracion`,
`Cuentas Bancarias`, `Caja Chica`, `Cierre Diario`, `Cuentas por Pagar`

---

### `permisos_usuarios`
Tabla pivote usuario ↔ módulo.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `usuario_id` | `INTEGER` | FK → `usuarios(id)` ON DELETE CASCADE | |
| `modulo_id` | `INTEGER` | FK → `modulos(id)` ON DELETE CASCADE | |
| `puede_ver` | `BOOLEAN` | DEFAULT true | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| | | UNIQUE(`usuario_id`, `modulo_id`) | |

---

## 3. Catálogos

### `marcas`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `VARCHAR(100)` | NOT NULL | |
| `descripcion` | `TEXT` | NULL | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `categorias`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `VARCHAR(100)` | NOT NULL | |
| `descripcion` | `TEXT` | NULL | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `subcategorias`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `VARCHAR(100)` | NOT NULL | |
| `descripcion` | `TEXT` | NULL | |
| `categoria_id` | `INTEGER` | FK → `categorias(id)` ON DELETE CASCADE | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | NULL | Set en UPDATE |

Índice único: `(razon_social_id, categoria_id, lower(nombre))`

---

### `almacenes`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `TEXT` | NOT NULL | |
| `ubicacion` | `TEXT` | NOT NULL | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `localizaciones`
Sub-ubicaciones dentro de un almacén (estantería, pasillo, etc.).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `almacen_id` | `INTEGER` | FK → `almacenes(id)` ON DELETE CASCADE | |
| `nombre` | `TEXT` | NOT NULL | |
| `descripcion` | `TEXT` | NULL | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `clientes`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `TEXT` | NOT NULL | |
| `rtn` | `TEXT` | NULL | |
| `direccion` | `TEXT` | NULL | |
| `telefono` | `TEXT` | NULL | Agregado migración 010 |
| `fecha_nacimiento` | `DATE` | NULL | Agregado migración 010 |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

Índice funcional: `to_char(fecha_nacimiento, 'MM-DD')` WHERE NOT NULL

---

### `proveedores`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `TEXT` | NOT NULL | |
| `rtn` | `TEXT` | NOT NULL | |
| `contacto` | `TEXT` | NOT NULL | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `productos`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `TEXT` | NOT NULL | |
| `codigo_barras` | `TEXT` | NULL | Recomendado UNIQUE por tenant |
| `precio_venta_sugerido` | `NUMERIC(12,2)` | NOT NULL DEFAULT 0 | |
| `costo_promedio` | `NUMERIC(12,2)` | DEFAULT 0 | Se recalcula al aprobar ingresos |
| `stock_total` | `NUMERIC(12,2)` | DEFAULT 0 | Se actualiza en cada movimiento |
| `foto_url` | `TEXT` | NULL | URL pública |
| `marca_id` | `INTEGER` | FK → `marcas(id)` ON DELETE SET NULL NULL | |
| `categoria_id` | `INTEGER` | FK → `categorias(id)` ON DELETE SET NULL NULL | |
| `subcategoria_id` | `INTEGER` | FK → `subcategorias(id)` ON DELETE SET NULL NULL | Migración 015 |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` ON DELETE SET NULL NULL | NULL = tienda propia |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | NULL | |

---

## 4. Portal de Emprendedores

### `emprendimientos`
Cada emprendimiento es un stand/local dentro del espacio.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `nombre` | `TEXT` | NOT NULL | Nombre del emprendimiento |
| `descripcion` | `TEXT` | NULL | |
| `email_contacto` | `TEXT` | NULL | |
| `telefono` | `TEXT` | NULL | |
| `zona` | `TEXT` | NULL | Área física en el espacio |
| `valor_alquiler_mensual` | `NUMERIC(12,2)` | NOT NULL DEFAULT 0 | Para módulo de pagos de alquiler |
| `activo` | `BOOLEAN` | NOT NULL DEFAULT true | |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `emprendedores_usuarios`
Usuarios del portal emprendedor (autenticación custom con bcrypt, **no** usa Supabase Auth).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` ON DELETE CASCADE | |
| `nombre` | `TEXT` | NOT NULL | Nombre real |
| `usuario` | `TEXT` | UNIQUE NOT NULL | Username de login |
| `password_hash` | `TEXT` | NOT NULL | Hash bcrypt |
| `activo` | `BOOLEAN` | DEFAULT true | |
| `session_token` | `TEXT` | NULL | Token de sesión activa |
| `token_expires_at` | `TIMESTAMPTZ` | NULL | Expiración del token |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

> La sesión se guarda en cookie httpOnly `emp_session`. El middleware valida el token contra esta tabla.

---

### `productos_pendientes`
Solicitudes de nuevos productos enviados por emprendedores para aprobación del admin.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` | |
| `razon_social_id` | `INTEGER` | NOT NULL | Multi-tenant |
| `nombre` | `TEXT` | NOT NULL | |
| `codigo_barras` | `TEXT` | NOT NULL | |
| `precio_venta_sugerido` | `NUMERIC(12,2)` | NOT NULL | |
| `precio_costo` | `NUMERIC(12,2)` | NULL | |
| `cantidad_inicial` | `INTEGER` | DEFAULT 0 | |
| `foto_url` | `TEXT` | NULL | |
| `marca_nombre` | `TEXT` | NULL | Desnormalizado (texto libre) |
| `categoria_nombre` | `TEXT` | NULL | Desnormalizado (texto libre) |
| `subcategoria_nombre` | `TEXT` | NULL | Desnormalizado (texto libre) |
| `estado` | `TEXT` | NOT NULL DEFAULT 'pendiente' | `pendiente` / `aprobado` / `rechazado` |
| `motivo_rechazo` | `TEXT` | NULL | |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | NULL | Set al aprobar/rechazar |

> Al **aprobar**: se inserta en `productos` + `transacciones_inventario` y se actualiza el stock.

---

### `ingresos_inventario_pendientes`
Solicitudes de restock (reabastecimiento) enviadas por emprendedores.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` | |
| `razon_social_id` | `INTEGER` | NOT NULL | Multi-tenant |
| `producto_id` | `INTEGER` | FK → `productos(id)` | |
| `almacen_id` | `INTEGER` | FK → `almacenes(id)` NULL | Puede ser nulo si no se especifica |
| `cantidad` | `NUMERIC(12,2)` | NOT NULL | |
| `costo_unitario` | `NUMERIC(12,2)` | NULL | Opcional; el admin puede editarlo |
| `estado` | `TEXT` | NOT NULL DEFAULT 'pendiente' | `pendiente` / `aprobado` / `rechazado` |
| `motivo_rechazo` | `TEXT` | NULL | |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | NULL | Set al aprobar/rechazar |

> Al **aprobar**: actualiza `productos.stock_total`, `productos.costo_promedio` (promedio ponderado) e inserta en `transacciones_inventario`.

---

### `cambios_precio_pendientes`
Solicitudes de cambio de `precio_venta_sugerido` enviadas por emprendedores.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `BIGSERIAL` | PK | |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` NOT NULL | |
| `razon_social_id` | `INTEGER` | NOT NULL | Multi-tenant |
| `producto_id` | `INTEGER` | FK → `productos(id)` NOT NULL | |
| `producto_nombre` | `TEXT` | NOT NULL | Desnormalizado (snapshot al solicitar) |
| `codigo_barras` | `TEXT` | NOT NULL | Desnormalizado |
| `precio_actual` | `NUMERIC(12,2)` | NOT NULL | Snapshot al solicitar |
| `precio_nuevo` | `NUMERIC(12,2)` | NOT NULL | Precio solicitado |
| `motivo` | `TEXT` | NULL | |
| `estado` | `TEXT` | NOT NULL DEFAULT 'pendiente' | `pendiente` / `aprobado` / `rechazado` |
| `motivo_rechazo` | `TEXT` | NULL | |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` | NULL | Set al aprobar/rechazar |

> Al **aprobar**: `UPDATE productos SET precio_venta_sugerido = precio_nuevo`.

---

### `liquidaciones_semanales`
Pago semanal (lunes-domingo) de la concept store a cada emprendedor — migración 022.
Snapshot de montos al generar/recalcular; congelado al marcar `pagado`.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE NOT NULL | Multi-tenant |
| `emprendimiento_id` | `INTEGER` | FK → `emprendimientos(id)` ON DELETE CASCADE NOT NULL | |
| `fecha_inicio` | `DATE` | NOT NULL | Lunes de la semana |
| `fecha_fin` | `DATE` | NOT NULL | Domingo |
| `monto_ventas` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | Σ ventas de la semana (neto post-comisión bancaria) |
| `monto_fletes` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | Σ fletes de envíos a descontar (positivo) |
| `monto_neto` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | `ventas - fletes` (puede ser negativo) |
| `estado` | `TEXT` | NOT NULL DEFAULT 'pendiente' CHECK | `pendiente` / `pagado` |
| `fecha_pago` | `TIMESTAMPTZ` | NULL | |
| `comprobante_url` | `TEXT` | NULL | Imagen del comprobante de transferencia (obligatorio al pagar, validado en app) |
| `notas` | `TEXT` | NULL | |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| | | UNIQUE(`emprendimiento_id`, `fecha_inicio`) | Idempotencia al regenerar |

---

## 5. Ventas

### `ventas_encabezado`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `numero_factura` | `TEXT` | NOT NULL | Ej: `FC-0001` |
| `cliente_id` | `INTEGER` | FK → `clientes(id)` | |
| `almacen_id` | `INTEGER` | FK → `almacenes(id)` NULL | Script `add-almacen-to-ventas-encabezado` |
| `fecha_venta` | `TIMESTAMPTZ` | DEFAULT now() | Hora Honduras (UTC-6) |
| `aplica_impuesto` | `BOOLEAN` | DEFAULT false | |
| `porcentaje_impuesto` | `NUMERIC(5,2)` | DEFAULT 15 | |
| `descuento` | `NUMERIC(5,2)` | DEFAULT 0 | % descuento global a la factura |
| `subtotal` | `NUMERIC(14,2)` | DEFAULT 0 | Antes de descuento |
| `impuesto_total` | `NUMERIC(14,2)` | DEFAULT 0 | |
| `total_venta` | `NUMERIC(14,2)` | DEFAULT 0 | Neto final |
| `estado_pago` | `TEXT` | DEFAULT 'Pendiente' | `Pendiente` / `Parcial` / `Pagado` |
| `valorpago` | `NUMERIC(14,2)` | DEFAULT 0 | Total pagado acumulado — migración 009 |
| `comisionbanc` | `NUMERIC(5,4)` | NULL | % comisión bancaria efectiva — promedio ponderado |
| `metodo_pago` | `TEXT` | NULL CHECK | `Efectivo`/`Banco`/`Link_Pago`/`Credito`/`Mixto`/`Otro` — migración 019 |
| `es_credito` | `BOOLEAN` | NOT NULL DEFAULT false | Migración 022: venta valor 0 que descuenta stock |
| `es_envio` | `BOOLEAN` | NOT NULL DEFAULT false | Migración 022 |
| `valor_flete` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | Migración 022: se descuenta al emprendedor en liquidación, no al cliente |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

> `saldo_pendiente = total_venta - valorpago`

---

### `ventas_detalle`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `venta_id` | `INTEGER` | FK → `ventas_encabezado(id)` ON DELETE CASCADE | |
| `producto_id` | `INTEGER` | FK → `productos(id)` | |
| `cantidad` | `NUMERIC(10,2)` | NOT NULL | |
| `precio_unitario` | `NUMERIC(14,4)` | NOT NULL | Neto si hay comisión bancaria; bruto si no |
| `costo_promedio_momento` | `NUMERIC(14,4)` | NOT NULL DEFAULT 0 | Snapshot del costo al vender |
| `utilidad_linea` | `NUMERIC(14,4)` | NOT NULL DEFAULT 0 | `(precio_neto - costo) × cantidad` |
| `descuentodetalle` | `NUMERIC(5,2)` | DEFAULT 0 | % descuento por línea — migración 020 |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |

---

### `pagos_ventas`
Historial de abonos a ventas a crédito (legacy, antes de `ventas_pagos_detalle`).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `venta_id` | `INTEGER` | FK → `ventas_encabezado(id)` | |
| `fecha_pago` | `TIMESTAMPTZ` | DEFAULT now() | |
| `monto` | `NUMERIC(14,2)` | NOT NULL | |
| `metodo_pago` | `TEXT` | NOT NULL | Texto libre |
| `razon_social_id` | `INTEGER` | | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |

---

### `ventas_pagos_detalle`
Desglose multi-método de pago por venta (creado en migración 011).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `venta_id` | `INTEGER` | FK → `ventas_encabezado(id)` ON DELETE CASCADE | |
| `metodo_pago` | `TEXT` | NOT NULL CHECK | `Efectivo`/`Banco`/`Link_Pago`/`Credito`/`Otro` |
| `cuenta_id` | `INTEGER` | FK → `cuentas_config(id)` NULL | Solo Banco/Link_Pago |
| `monto_bruto` | `NUMERIC(14,2)` | NOT NULL ≥ 0 | Lo que paga el cliente |
| `porcentaje_comision` | `NUMERIC(5,2)` | NOT NULL DEFAULT 0 | Snapshot % comisión |
| `monto_neto` | `NUMERIC(14,2)` | NOT NULL | `monto_bruto × (1 - comisión/100)` |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

## 6. Tesorería

### `cuentas_config`
Bancos y links de pago con su % de comisión.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `nombre` | `TEXT` | NOT NULL | Ej: `"BAC Honduras"` |
| `tipo` | `TEXT` | NOT NULL CHECK | `Banco` / `Link_Pago` / `Otro` |
| `porcentaje_comision` | `NUMERIC(5,2)` | NOT NULL DEFAULT 0 (0–100) | |
| `activo` | `BOOLEAN` | NOT NULL DEFAULT true | |
| `saldo` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | Saldo running cacheado |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `cuenta_movimientos`
Trazabilidad de cada ingreso/egreso por cuenta bancaria.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `cuenta_id` | `INTEGER` | FK → `cuentas_config(id)` ON DELETE CASCADE | |
| `fecha` | `TIMESTAMPTZ` | DEFAULT now() | |
| `tipo` | `TEXT` | NOT NULL CHECK | `Ingreso` / `Egreso` |
| `monto` | `NUMERIC(14,2)` | NOT NULL | Neto (después de comisión) |
| `monto_bruto` | `NUMERIC(14,2)` | NULL | Bruto (lo que pagó el cliente) — migración 018 |
| `concepto` | `TEXT` | NULL | |
| `ref_tipo` | `TEXT` | NULL | `'venta'` / `'transferencia_caja'` / etc. |
| `ref_id` | `INTEGER` | NULL | ID del registro referenciado |
| `saldo_resultante` | `NUMERIC(14,2)` | NOT NULL | Saldo después del movimiento |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `caja_chica_sesiones`
Una sesión abierta por `razon_social_id` a la vez (restricción por índice parcial único).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `fecha_apertura` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | |
| `saldo_inicial` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | |
| `fecha_cierre` | `TIMESTAMPTZ` | NULL | Set al cerrar |
| `saldo_final_real` | `NUMERIC(14,2)` | NULL | Lo que el usuario contó |
| `saldo_final_calculado` | `NUMERIC(14,2)` | NULL | Calculado automáticamente |
| `diferencia` | `NUMERIC(14,2)` | NULL | `real - calculado` |
| `estado` | `TEXT` | NOT NULL CHECK | `Abierta` / `Cerrada` |
| `usuario_apertura` | `TEXT` | NULL | |
| `usuario_cierre` | `TEXT` | NULL | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

Índice único parcial: `(razon_social_id) WHERE estado = 'Abierta'` — garantiza máx. 1 sesión abierta.

---

### `caja_chica_conteos`
Detalle del conteo físico de billetes (Lempiras) en apertura y cierre — migración 022.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE NOT NULL | Multi-tenant |
| `sesion_id` | `INTEGER` | FK → `caja_chica_sesiones(id)` ON DELETE CASCADE NOT NULL | |
| `tipo` | `TEXT` | NOT NULL CHECK | `Apertura` / `Cierre` |
| `detalle` | `JSONB` | NOT NULL | `{"500": 3, "200": 1, ...}` cantidad por denominación |
| `total` | `NUMERIC(14,2)` | NOT NULL | Suma denominación × cantidad |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |
| | | UNIQUE(`sesion_id`, `tipo`) | Un conteo por sesión/tipo (upsert al recontar) |

---

### `caja_chica_movimientos`
Cada movimiento de efectivo dentro de una sesión.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `sesion_id` | `INTEGER` | FK → `caja_chica_sesiones(id)` ON DELETE CASCADE **NULLABLE** | Migración 017: nullable para ingresos sin sesión activa |
| `fecha` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | |
| `tipo` | `TEXT` | NOT NULL CHECK | `Apertura`/`Ingreso_Manual`/`Ingreso_Venta`/`Salida`/`Transferencia_Banco`/`Cierre` |
| `monto` | `NUMERIC(14,2)` | NOT NULL | Positivo = entrada, negativo = salida |
| `concepto` | `TEXT` | NULL | |
| `ref_tipo` | `TEXT` | NULL | `'venta'` / etc. |
| `ref_id` | `INTEGER` | NULL | ID del registro referenciado |
| `cuenta_destino_id` | `INTEGER` | FK → `cuentas_config(id)` NULL | Solo para `Transferencia_Banco` |
| `saldo_resultante` | `NUMERIC(14,2)` | NOT NULL | |
| `usuario` | `TEXT` | NULL | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

## 7. Gastos y Cuentas por Pagar

### `conceptos_gastos`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `nombre` | `VARCHAR(100)` | NOT NULL | |
| `categoria_macro` | `VARCHAR(50)` | NOT NULL CHECK | `Servicios`/`Publicidad`/`Nomina`/`Arriendo`/`Mantenimiento`/`Impuestos`/`Suministros`/`Otros` |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `gastos`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `concepto_id` | `INTEGER` | FK → `conceptos_gastos(id)` ON DELETE RESTRICT | |
| `fecha_gasto` | `DATE` | NOT NULL | |
| `monto` | `DECIMAL(12,2)` | NOT NULL > 0 | Monto total del gasto |
| `metodo_pago` | `VARCHAR(20)` | NOT NULL CHECK | `Efectivo`/`Transferencia`/`Tarjeta` |
| `descripcion` | `TEXT` | NULL | |
| `comprobante_url` | `TEXT` | NULL | |
| `proveedor_nombre` | `TEXT` | NULL | Migración 014 |
| `numero_factura` | `TEXT` | NULL | Migración 014 |
| `fecha_vencimiento` | `DATE` | NULL | Migración 014 |
| `monto_pagado` | `NUMERIC(14,2)` | NOT NULL DEFAULT 0 | Migración 014 |
| `estado_pago` | `TEXT` | NOT NULL DEFAULT 'Pendiente' CHECK | `Pendiente`/`Parcial`/`Pagado` — Migración 014 |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `gastos_pagos_detalle`
Historial de abonos a cada gasto (cuentas por pagar).

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `gasto_id` | `INTEGER` | FK → `gastos(id)` ON DELETE CASCADE | |
| `fecha_pago` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | |
| `monto` | `NUMERIC(14,2)` | NOT NULL > 0 | |
| `metodo_pago` | `TEXT` | NOT NULL CHECK | `Efectivo`/`Banco`/`Otro` |
| `cuenta_id` | `INTEGER` | FK → `cuentas_config(id)` NULL | |
| `caja_movimiento_id` | `INTEGER` | NULL | Referencia cruzada de auditoría |
| `cuenta_movimiento_id` | `INTEGER` | NULL | Referencia cruzada de auditoría |
| `concepto` | `TEXT` | NULL | |
| `usuario` | `TEXT` | NULL | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

## 8. Inventario y Compras

### `transacciones_inventario`
Kardex: cada entrada y salida de stock.

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `producto_id` | `INTEGER` | FK → `productos(id)` | |
| `almacen_id` | `INTEGER` | FK → `almacenes(id)` | |
| `localizacion_id` | `INTEGER` | FK → `localizaciones(id)` | |
| `tipo_movimiento` | `TEXT` | NOT NULL | `'Salida Venta'` / `'Ingreso Manual'` / etc. |
| `cantidad` | `NUMERIC(12,2)` | NOT NULL | Negativo = salida |
| `costo_o_precio_unitario` | `NUMERIC(14,4)` | | |
| `referencia_id` | `INTEGER` | NULL | ID de la venta o ingreso origen |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `fecha` | `TIMESTAMPTZ` | DEFAULT now() | |

---

### `compras_encabezado`

| Columna | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | `SERIAL` | PK | |
| `proveedor_id` | `INTEGER` | FK → `proveedores(id)` | |
| `fecha_compra` | `DATE` | NOT NULL | |
| `numero_orden` | `TEXT` | NULL | |
| `estado` | `TEXT` | | `Borrador`/`Recibida`/`Cancelada` |
| `total` | `NUMERIC(14,2)` | DEFAULT 0 | |
| `razon_social_id` | `INTEGER` | FK → `razon_social(id)` ON DELETE CASCADE | Multi-tenant |
| `usuario` | `TEXT` | NULL | Auditoría |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | |

---

## 9. Vistas

### `vista_cierre_diario`
Resumen diario de ventas por método de pago, por `(razon_social_id, fecha)`.

```sql
SELECT
  razon_social_id, fecha,
  cantidad_tickets, total_ventas,
  ingresos_efectivo,
  ingresos_banco_bruto, ingresos_banco_neto,
  credito_total, comisiones_total
```

Fuentes: `ventas_encabezado` + `ventas_pagos_detalle`

---

### `vista_cuentas_por_pagar`
Gastos con `estado_pago <> 'Pagado'`, calcula `saldo_pendiente` y `dias_vencido`.

```sql
SELECT
  id, razon_social_id, concepto_id, concepto_nombre, categoria_macro,
  proveedor_nombre, numero_factura, fecha_gasto, fecha_vencimiento,
  monto, monto_pagado, saldo_pendiente, estado_pago,
  descripcion, comprobante_url, dias_vencido, created_at
```

Fuentes: `gastos` JOIN `conceptos_gastos`

---

### `vista_historico_caja_chica`
Resumen por sesión: saldo inicial, total ingresos, total egresos, diferencia.

```sql
SELECT
  sesion_id, razon_social_id,
  fecha_apertura, fecha_cierre,
  usuario_apertura, usuario_cierre, estado,
  saldo_inicial, total_ingresos, total_egresos,
  saldo_final_calculado, saldo_final_real, diferencia
```

Fuentes: `caja_chica_sesiones` + `caja_chica_movimientos`

---

### `vista_stock_por_localizacion` *(inferida)*
Vista de stock agregado por localización, usada en el módulo de inventario.

```sql
SELECT producto_id, emprendimiento_id, stock_actual
```

Fuentes: `transacciones_inventario` (SUM por producto + localización)

---

## 10. Script SQL completo

Ejecuta este script en el **SQL Editor de Supabase** del nuevo proyecto, en orden.
Reemplaza `emprendedores` por el nombre de esquema que prefieras.

```sql
-- ============================================================
-- PASO 0: Crear esquema
-- ============================================================
CREATE SCHEMA IF NOT EXISTS emprendedores;

-- Exponer en PostgREST: Dashboard → Database → API → Exposed schemas
-- Agregar "emprendedores"

-- ============================================================
-- PASO 1: Tablas base (sin FK a otras tablas del esquema)
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

CREATE TABLE IF NOT EXISTS emprendedores.modulos (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  orden       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO emprendedores.modulos (nombre, descripcion, orden) VALUES
  ('Dashboard',         'Panel principal con KPIs', 1),
  ('Ventas',            'Gestion de ventas y cobros', 2),
  ('Inventario',        'Kardex, ingresos y traslados', 3),
  ('Finanzas',          'Gastos y estado de resultados', 4),
  ('Configuracion',     'Catalogos y parametros', 5),
  ('Cuentas Bancarias', 'Gestion de bancos y % de comisiones', 6),
  ('Caja Chica',        'Sesiones de caja menor', 7),
  ('Cierre Diario',     'Cierre diario de operaciones', 8),
  ('Cuentas por Pagar', 'Facturas pendientes y abonos', 9),
  ('Aprobaciones',      'Solicitudes pendientes de emprendedores', 10)
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- PASO 2: Usuarios admin (usa Supabase Auth — auth.users)
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

CREATE TABLE IF NOT EXISTS emprendedores.permisos_usuarios (
  id          SERIAL PRIMARY KEY,
  usuario_id  UUID NOT NULL REFERENCES emprendedores.usuarios(id) ON DELETE CASCADE,
  modulo_id   INTEGER NOT NULL REFERENCES emprendedores.modulos(id) ON DELETE CASCADE,
  puede_ver   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(usuario_id, modulo_id)
);

-- ============================================================
-- PASO 3: Catálogos
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
CREATE INDEX IF NOT EXISTS idx_clientes_cumple_mmdd
  ON emprendedores.clientes (to_char(fecha_nacimiento, 'MM-DD'))
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
-- PASO 4: Emprendimientos
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
-- PASO 5: Productos
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
CREATE INDEX IF NOT EXISTS idx_productos_razon_social ON emprendedores.productos(razon_social_id);
CREATE INDEX IF NOT EXISTS idx_productos_emprendimiento ON emprendedores.productos(emprendimiento_id);

-- ============================================================
-- PASO 6: Pendientes (flujo de aprobación emprendedores)
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
-- PASO 7: Tesorería
-- ============================================================

CREATE TABLE IF NOT EXISTS emprendedores.cuentas_config (
  id                   SERIAL PRIMARY KEY,
  razon_social_id      INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  nombre               TEXT NOT NULL,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('Banco','Link_Pago','Otro')),
  porcentaje_comision  NUMERIC(5,2) NOT NULL DEFAULT 0
                       CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_sesion_abierta
  ON emprendedores.caja_chica_sesiones(razon_social_id) WHERE estado = 'Abierta';

CREATE TABLE IF NOT EXISTS emprendedores.caja_chica_movimientos (
  id                SERIAL PRIMARY KEY,
  razon_social_id   INTEGER NOT NULL REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  sesion_id         INTEGER REFERENCES emprendedores.caja_chica_sesiones(id) ON DELETE CASCADE,  -- nullable (migración 017)
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
-- PASO 8: Ventas
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
  razon_social_id     INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ventas_enc_razon_social ON emprendedores.ventas_encabezado(razon_social_id);
CREATE INDEX IF NOT EXISTS idx_ventas_enc_fecha ON emprendedores.ventas_encabezado(fecha_venta DESC);

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
  id          SERIAL PRIMARY KEY,
  venta_id    INTEGER REFERENCES emprendedores.ventas_encabezado(id),
  fecha_pago  TIMESTAMPTZ DEFAULT now(),
  monto       NUMERIC(14,2) NOT NULL,
  metodo_pago TEXT NOT NULL,
  razon_social_id INTEGER,
  usuario     TEXT
);

-- ============================================================
-- PASO 9: Inventario y Compras
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

CREATE TABLE IF NOT EXISTS emprendedores.compras_encabezado (
  id              SERIAL PRIMARY KEY,
  proveedor_id    INTEGER REFERENCES emprendedores.proveedores(id),
  fecha_compra    DATE NOT NULL,
  numero_orden    TEXT,
  estado          TEXT DEFAULT 'Borrador',
  total           NUMERIC(14,2) DEFAULT 0,
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  usuario         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- PASO 10: Gastos y Cuentas por Pagar
-- ============================================================

CREATE TABLE IF NOT EXISTS emprendedores.conceptos_gastos (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  categoria_macro VARCHAR(50) NOT NULL CHECK (categoria_macro IN ('Servicios','Publicidad','Nomina','Arriendo','Mantenimiento','Impuestos','Suministros','Otros')),
  razon_social_id INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emprendedores.gastos (
  id                SERIAL PRIMARY KEY,
  concepto_id       INTEGER NOT NULL REFERENCES emprendedores.conceptos_gastos(id) ON DELETE RESTRICT,
  fecha_gasto       DATE NOT NULL,
  monto             DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago       VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('Efectivo','Transferencia','Tarjeta')),
  descripcion       TEXT,
  comprobante_url   TEXT,
  proveedor_nombre  TEXT,
  numero_factura    TEXT,
  fecha_vencimiento DATE,
  monto_pagado      NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado_pago       TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado_pago IN ('Pendiente','Parcial','Pagado')),
  razon_social_id   INTEGER REFERENCES emprendedores.razon_social(id) ON DELETE CASCADE,
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
-- PASO 11: Vistas
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

-- ============================================================
-- PASO 12: Storage (ejecutar manualmente en Supabase Dashboard)
-- ============================================================
-- 1. Crear bucket público "logos" en Storage
-- 2. Agregar políticas: Public read / write / update / delete
--    (ver script 003-add-logo-and-storage.sql para el detalle)
```

---

## 11. Variables de entorno

Archivo `.env.local` requerido:

```env
NEXT_PUBLIC_SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Obtener de: **Supabase Dashboard → Project Settings → API**

---

## 12. Patrones arquitecturales

### Multi-tenant
Todas las tablas de negocio tienen `razon_social_id`. Cada query en el código agrega `.eq('razon_social_id', stamp.razon_social_id)` automáticamente via `getTenantStamp()`.

### Auditoría
Campo `usuario` (TEXT) en todas las tablas: guarda el nombre del usuario que creó/modificó el registro. Se inyecta también via `getTenantStamp()`.

### Flujo de aprobación (Emprendedores → Admin)
Las tres tablas de pendientes (`productos_pendientes`, `ingresos_inventario_pendientes`, `cambios_precio_pendientes`) siguen el mismo patrón:
- Estado `pendiente` al crear
- Admin aprueba → efecto en tabla destino + estado `aprobado`
- Admin rechaza → `motivo_rechazo` + estado `rechazado`

### Autenticación dual
- **Admin**: Supabase Auth (`auth.users`) → `usuarios.auth_user_id`
- **Emprendedores**: autenticación custom bcrypt → cookie `emp_session` → `emprendedores_usuarios.session_token`

### Precios con comisión bancaria
Cuando `ventas_encabezado.comisionbanc > 0`, el `precio_unitario` en `ventas_detalle` se guarda como **neto** (ya descontada la comisión). Para ventas antiguas (`comisionbanc = null/0`) es el precio bruto.
