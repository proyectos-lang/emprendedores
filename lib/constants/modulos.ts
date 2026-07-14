/**
 * Fuente unica de verdad para los 23 modulos granulares del sistema.
 *
 * El campo `nombre` DEBE coincidir exactamente (case-sensitive) con la columna
 * `modulos.nombre` en la base de datos, ya que se usa como clave de los
 * permisos (`permisos_usuarios.modulo_id -> modulos.nombre`).
 *
 * Estructura:
 *   - `nombre`: clave del permiso en la DB y etiqueta visible.
 *   - `href`: ruta que se abre al hacer click (y que protege el RouteGuard).
 *   - `categoria`: grupo visual en el sidebar.
 *   - `icon`: icono (lucide-react).
 */

import {
  LayoutDashboard,
  BarChart3,
  ShoppingCart,
  History,
  FileText,
  ClipboardList,
  PackagePlus,
  DollarSign,
  Building2,
  Users,
  Package,
  Warehouse,
  Truck,
  Landmark,
  Wallet,
  ClipboardCheck,
  Store,
  ListChecks,
  CreditCard,
  Banknote,
  type LucideIcon,
} from "lucide-react"

export type Categoria =
  | "Dashboard"
  | "Ventas"
  | "Inventario"
  | "Finanzas"
  | "Configuracion"
  | "Concept Store"

export interface ModuloGranular {
  /** Coincide exactamente con `modulos.nombre` en la DB */
  nombre: string
  /** Ruta del modulo (sirve tambien para la proteccion de rutas) */
  href: string
  /** Grupo visual en el sidebar */
  categoria: Categoria
  /** Icono lucide */
  icon: LucideIcon
  /**
   * Nombres alternativos que pueden aparecer en la DB (sinonimos abreviados).
   * Se matchean de forma exacta con `findModuloByDBName` (tolerando tildes).
   * Usalo cuando la DB guarde un nombre mas corto que no contiene todos los
   * tokens del nombre canonico (ej. DB "Historial" -> canonico "Historial Ventas").
   */
  aliases?: string[]
}

/**
 * 23 modulos granulares. Cualquier cambio aqui debe replicarse en la tabla
 * `modulos` (y viceversa).
 */
export const MODULOS: ReadonlyArray<ModuloGranular> = [
  // ── Dashboard ──────────────────────────────────────────────────────────
  { nombre: "Dashboard", href: "/dashboard", categoria: "Dashboard", icon: LayoutDashboard },

  // ── Ventas ─────────────────────────────────────────────────────────────
  { nombre: "Dashboard Ventas", href: "/ventas/dashboard", categoria: "Ventas", icon: BarChart3 },
  { nombre: "Nueva Venta", href: "/ventas/nueva", categoria: "Ventas", icon: ShoppingCart },
  {
    nombre: "Historial Ventas",
    href: "/ventas/historial",
    categoria: "Ventas",
    icon: History,
    aliases: ["Historial"],
  },

  // ── Inventario ─────────────────────────────────────────────────────────
  {
    nombre: "Historial de Transacciones",
    href: "/inventario/kardex",
    categoria: "Inventario",
    icon: ClipboardList,
  },
  {
    nombre: "Movimientos Manuales",
    href: "/inventario/ingreso",
    categoria: "Inventario",
    icon: PackagePlus,
    aliases: ["Ingreso Manual"],
  },
  { nombre: "Valoracion", href: "/inventario/valoracion", categoria: "Inventario", icon: DollarSign },

  // ── Finanzas ───────────────────────────────────────────────────────────
  {
    nombre: "Estado de Resultados",
    href: "/finanzas/estado-resultados",
    categoria: "Finanzas",
    icon: FileText,
  },
  { nombre: "Gastos", href: "/finanzas/gastos", categoria: "Finanzas", icon: DollarSign },
  { nombre: "Caja Chica", href: "/finanzas/caja-chica", categoria: "Finanzas", icon: Wallet },
  {
    nombre: "Cierre Diario",
    href: "/finanzas/cierre-diario",
    categoria: "Finanzas",
    icon: ClipboardCheck,
  },

  // ── Configuracion ──────────────────────────────────────────────────────
  { nombre: "Razon Social", href: "/configuracion/razon-social", categoria: "Configuracion", icon: Building2 },
  { nombre: "Usuarios y Permisos", href: "/configuracion/usuarios", categoria: "Configuracion", icon: Users },
  { nombre: "Productos", href: "/configuracion/productos", categoria: "Configuracion", icon: Package },
  { nombre: "Almacenes", href: "/configuracion/almacenes", categoria: "Configuracion", icon: Warehouse },
  { nombre: "Clientes", href: "/configuracion/clientes", categoria: "Configuracion", icon: Users },
  { nombre: "Proveedores", href: "/configuracion/proveedores", categoria: "Configuracion", icon: Truck },
  {
    nombre: "Cuentas Bancarias",
    href: "/configuracion/cuentas-bancarias",
    categoria: "Configuracion",
    icon: Landmark,
  },
  {
    nombre: "Preview PDFs",
    href: "/configuracion/previsualizacion-pdf",
    categoria: "Configuracion",
    icon: FileText,
  },

  // ── Concept Store ──────────────────────────────────────────────────────
  {
    nombre: "Emprendimientos",
    href: "/emprendimientos",
    categoria: "Concept Store",
    icon: Store,
  },
  {
    nombre: "Pagos de Alquiler",
    href: "/concept-store/pagos-alquiler",
    categoria: "Concept Store",
    icon: CreditCard,
  },
  {
    nombre: "Aprobaciones",
    href: "/aprobaciones",
    categoria: "Concept Store",
    icon: ListChecks,
  },
  {
    nombre: "Liquidaciones",
    href: "/concept-store/liquidaciones",
    categoria: "Concept Store",
    icon: Banknote,
  },
] as const

/** Orden fijo de categorias para el sidebar */
export const CATEGORIAS_ORDEN: ReadonlyArray<Categoria> = [
  "Dashboard",
  "Ventas",
  "Inventario",
  "Finanzas",
  "Configuracion",
  "Concept Store",
]

/**
 * Devuelve el modulo (si existe) que protege la ruta actual.
 * Usa prefijo con `startsWith` para que /ventas/nueva/abc tambien matchee
 * "Nueva Venta". En caso de colision (ej. /ventas/dashboard vs /ventas),
 * gana el match mas largo.
 */
export function findModuloByPath(pathname: string): ModuloGranular | null {
  let best: ModuloGranular | null = null
  for (const m of MODULOS) {
    if (pathname === m.href || pathname.startsWith(m.href + "/")) {
      if (!best || m.href.length > best.href.length) best = m
    }
  }
  return best
}

/**
 * Normaliza un nombre a tokens: lowercase, sin tildes, sin palabras vacias,
 * con un stemming basico (quita la 's' final) para que
 * "venta"/"ventas", "compra"/"compras", etc. se consideren iguales.
 *
 * Asi "Valoración" y "Valoracion" producen los mismos tokens, y
 * "Historial de Ventas" matchea contra "Historial Ventas" aunque
 * un lado use singular y el otro plural.
 */
const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "por", "en", "a",
])

function stem(t: string): string {
  // Stem minimo para espanol: quita 's' final solo si la palabra tiene >=4
  // chars (evita reducir palabras cortas como "mas", "tres").
  if (t.length >= 4 && t.endsWith("s")) return t.slice(0, -1)
  return t
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s_\-/.,]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem)
}

/**
 * Dado un nombre proveniente de la DB (columna `modulos.nombre`), encuentra
 * el ModuloGranular de constants que mejor lo representa.
 *
 * Criterio: todos los tokens del constants deben estar presentes en el nombre
 * de DB. Cuando varios candidatos califican, gana el MAS ESPECIFICO (mas
 * tokens en el nombre del constants).
 *
 * Ejemplos:
 *   - DB "Valoración"             -> constants "Valoracion"
 *   - DB "Recepción por OC"       -> constants "Recepcion por OC"
 *   - DB "Dashboard de Ventas"    -> constants "Dashboard Ventas"
 *   - DB "Dashboard"              -> constants "Dashboard"
 */
export function findModuloByDBName(dbName: string): ModuloGranular | null {
  const dbTokens = new Set(tokenize(dbName))
  if (dbTokens.size === 0) return null

  // 1) Prioridad maxima: alias exacto (mismos tokens). Esto permite que
  //    un nombre corto en la DB (ej. "Historial") se mapee a su canonico
  //    ("Historial Ventas") sin ambiguedad.
  const dbKey = [...dbTokens].sort().join("|")
  for (const m of MODULOS) {
    if (!m.aliases) continue
    for (const alias of m.aliases) {
      const aliasKey = [...new Set(tokenize(alias))].sort().join("|")
      if (aliasKey === dbKey) return m
    }
  }

  // 2) Criterio general: todos los tokens del canonico deben estar en el
  //    nombre de DB. Gana el match mas especifico (mas tokens).
  let best: ModuloGranular | null = null
  let bestScore = 0
  for (const m of MODULOS) {
    const cTokens = tokenize(m.nombre)
    if (cTokens.length === 0) continue
    const allIn = cTokens.every((t) => dbTokens.has(t))
    if (!allIn) continue
    if (cTokens.length > bestScore) {
      best = m
      bestScore = cTokens.length
    }
  }
  return best
}
