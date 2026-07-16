# EasyCount Emprendedores — Contexto del Proyecto y Registro de Cambios

## Descripción General

**EasyCount** es un sistema ERP multi-tenant con interfaz en español, construido sobre Next.js 16 / React 19 / TypeScript / Supabase. Cubre ventas, compras, inventario y finanzas con control de acceso basado en módulos y procesamiento de documentos con IA (Gemini).

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16.1.6 (App Router) |
| Frontend | React 19.2.4 + TypeScript 5.7.3 |
| Estilos | Tailwind CSS 4.2.0 + Radix UI + Shadcn/ui |
| Base de Datos | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, JWT via cookies) |
| Formularios | React Hook Form + Zod |
| Gráficas | Recharts |
| Exportación | XLSX, jsPDF |
| IA | Google Gemini API |

---

## Variables de Entorno Requeridas

```env
NEXT_PUBLIC_SUPABASE_URL=         # URL pública del proyecto Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Clave anónima (pública) de Supabase
SUPABASE_SERVICE_ROLE_KEY=        # Clave service role (solo servidor)
NEXT_PUBLIC_GEMINI_API_KEY=       # Google Gemini API (funciones IA)
```

---

## Módulos del Sistema (23 total)

1. Dashboard principal
2. Ventas — Nueva venta
3. Ventas — Historial
4. Ventas — Dashboard de ventas
5. Ventas — Pagos
6. Ventas — Cuentas por cobrar
7. Compras — Orden de compra
8. Compras — Recepción por OC
9. Compras — Recepción por factura (IA)
10. Inventario — Kardex
11. Inventario — Ingreso manual
12. Inventario — Traslados
13. Inventario — Valoración
14. Finanzas — Estado de resultados
15. Finanzas — Gastos
16. Finanzas — Caja chica
17. Finanzas — Cierre diario
18. Configuración — Razón social
19. Configuración — Usuarios y permisos
20. Configuración — Productos
21. Configuración — Almacenes
22. Configuración — Clientes
23. Configuración — Proveedores

---

## Estructura de Archivos Clave

```
lib/supabase/client.ts      — Cliente Supabase para browser
lib/supabase/server.ts      — Cliente Supabase para Server Components
lib/supabase/admin.ts       — Cliente admin (service role)
lib/contexts/auth-context.tsx — Contexto global de autenticación
lib/services/               — Capa de servicios (13 archivos, abstracción sobre Supabase)
lib/constants/modulos.ts    — Definición de los 23 módulos y permisos
components/erp-sidebar.tsx  — Sidebar de navegación principal
components/route-guard.tsx  — Protección de rutas por permisos
app/(dashboard)/            — Rutas protegidas del dashboard
```

---

## Multi-tenancy

Cada tabla principal incluye `razon_social_id` para aislamiento de datos entre empresas. El ID del tenant se obtiene del contexto de autenticación y se aplica en todas las consultas de la capa de servicios.

---

## Esquema de Base de Datos — Tablas Principales

> **Pendiente:** El usuario va a proporcionar el esquema completo del nuevo esquema de base de datos al que se conectará esta aplicación.

Tablas conocidas del esquema actual:
- `usuarios` — Cuentas de usuario vinculadas a `auth.users`
- `razon_social` — Datos maestros de empresa
- `productos` — Catálogo de productos
- `marcas`, `categorias` — Clasificación de productos
- `almacenes`, `localizaciones` — Bodegas y ubicaciones
- `clientes`, `proveedores` — Terceros
- `ventas_encabezado`, `ventas_detalle` — Transacciones de venta
- `pagos_ventas` — Registros de pago
- `compras_encabezado`, `compras_detalle` — Órdenes de compra
- `transacciones_inventario` — Movimientos de inventario (kardex)
- `gastos` — Gastos
- `caja_chica` — Caja chica
- `cuentas_config` — Cuentas bancarias
- `cuentas_por_pagar` — Cuentas por pagar
- `modulos`, `permisos_usuarios` — Permisos

---

## Registro de Cambios

### Sesión 1 — 2026-06-10

**Objetivo:** Conectar la aplicación al esquema `emprendedores` del proyecto Supabase `qpwjwfparpupfyuxoskx`.

**Cambios aplicados:**

1. **`.env.local` creado** con las 4 variables de entorno del proyecto Supabase.

2. **`lib/supabase/client.ts`** — Agregado `db: { schema: 'emprendedores' }` al `createBrowserClient`.
3. **`lib/supabase/server.ts`** — Agregado `db: { schema: 'emprendedores' }` al `createServerClient`.
4. **`lib/supabase/admin.ts`** — Agregado `db: { schema: 'emprendedores' }` al `createSupabaseClient`.

**Por qué solo esos 3 archivos:** El SDK de Supabase JS usa `public` como esquema por defecto. Con `db: { schema: 'emprendedores' }` cada llamada `.from('tabla')` apunta a `emprendedores.tabla` automáticamente — no se requiere cambiar ningún servicio.

**Compatibilidad verificada:** El código de la app ya usa los nombres de tablas del esquema `emprendedores` (`caja_chica_movimientos`, `caja_chica_sesiones`, `ventas_pagos_detalle`, `subcategorias`, `cuenta_movimientos`).

**Punto a vigilar:** Las tablas `localizaciones` y `caja_chica_sesiones` en `emprendedores` no tienen FK explícita a `razon_social` según el esquema. El código actual stampa `razon_social_id` en inserts de localizaciones; si esa columna no existe en `emprendedores.localizaciones`, fallará al crear localizaciones nuevas. A confirmar con prueba.

---

### Sesión 2 — 2026-07-16

**Objetivo:** Independizar el proyecto por completo (código, base de datos y repositorio) de "Colmena".

**Cambios aplicados:**

1. Se agregaron 4 funcionalidades nuevas: liquidaciones semanales a emprendedores, conteo de billetes en apertura/cierre de caja, venta a crédito y envíos con flete (ver `scripts/022-liquidaciones-conteo-caja-credito-envio.sql`).
2. Se eliminaron todas las menciones a "Colmena" del código en ejecución: título del Dashboard, datos de fallback del recibo térmico (incluía un RTN, teléfono y dirección reales hardcodeados que se imprimían en cada factura sin importar la razón social configurada), mensajes de error internos y la clave de `localStorage` de carritos temporales.
3. Se actualizó este changelog y `SUPABASE_SCHEMA.md`, y se renombraron las referencias a `colmena.tabla` en los scripts de migración históricos (`017`–`021`) a `emprendedores.tabla`.
4. El repositorio ahora vive en `https://github.com/proyectos-lang/emprendedores.git` (antes compartía remoto con `colmena.git`).

---

## Decisiones Técnicas

_Se irán registrando aquí a medida que avance el proyecto._

---

## Notas de Arquitectura

- Los clientes Supabase están en `lib/supabase/`. Para cambiar de proyecto solo se necesita actualizar las variables de entorno.
- Los servicios en `lib/services/` tienen un patrón de fallback a localStorage cuando Supabase no está configurado.
- `RouteGuard` valida permisos de módulo antes de renderizar cada ruta.
- La barra lateral se genera dinámicamente a partir de `lib/constants/modulos.ts` + permisos del usuario.
