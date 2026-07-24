"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getEmprendedorSession } from "@/app/login-emprendedor/actions"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

export interface ProductoEditable {
  id: number
  nombre: string
  codigo_barras: string
  precio_venta_sugerido: number
}

const MAX_NOMBRE = 200

/**
 * Lista los productos del emprendimiento de la sesion actual. El
 * emprendimiento NUNCA se toma de un parametro del cliente: se resuelve
 * desde la cookie httpOnly (`getEmprendedorSession`), porque estas
 * funciones usan el cliente admin (service role) que salta RLS.
 */
export async function getMisProductos(
  query?: string
): Promise<{ data: ProductoEditable[]; error: string | null }> {
  const sesion = await getEmprendedorSession()
  if (!sesion) return { data: [], error: "Sesion expirada. Vuelve a iniciar sesion." }

  const supabase = createAdminClient()
  if (!supabase) return { data: [], error: "Error de conexion" }

  let q = supabase
    .from("productos")
    .select("id, nombre, codigo_barras, precio_venta_sugerido")
    .eq("emprendimiento_id", sesion.emprendimientoId)
    .order("nombre", { ascending: true })
    .limit(300)

  const term = query?.trim()
  if (term) q = q.or(`nombre.ilike.%${term}%,codigo_barras.ilike.%${term}%`)

  const { data, error } = await q

  if (error) {
    console.error("[editar-productos] Error getMisProductos:", error)
    return { data: [], error: error.message }
  }

  return {
    data: (data ?? []).map((p: any) => ({
      id: p.id,
      nombre: p.nombre ?? "",
      codigo_barras: p.codigo_barras ?? "",
      precio_venta_sugerido: Number(p.precio_venta_sugerido ?? 0),
    })),
    error: null,
  }
}

/**
 * Actualiza el nombre de un producto del emprendedor, directo en el
 * maestro `productos` (sin flujo de aprobacion).
 *
 * Seguridad: el UPDATE filtra por `emprendimiento_id` de la SESION, no por
 * un id recibido del cliente. Si el producto no pertenece al emprendedor,
 * el filtro no matchea ninguna fila y la operacion falla — no puede editar
 * productos de otro emprendimiento ni de la tienda propia.
 */
export async function actualizarProductoEmprendedor(
  productoId: number,
  input: { nombre: string }
): Promise<{ error: string | null }> {
  const sesion = await getEmprendedorSession()
  if (!sesion) return { error: "Sesion expirada. Vuelve a iniciar sesion." }

  const nombre = input.nombre.trim()
  if (!nombre) return { error: "El nombre no puede estar vacio" }
  if (nombre.length > MAX_NOMBRE) {
    return { error: `El nombre no puede superar ${MAX_NOMBRE} caracteres` }
  }

  const supabase = createAdminClient()
  if (!supabase) return { error: "Error de conexion" }

  const { data, error } = await supabase
    .from("productos")
    .update({
      nombre,
      usuario: sesion.nombre,
      updated_at: getHondurasNowISO(),
    })
    .eq("id", productoId)
    .eq("emprendimiento_id", sesion.emprendimientoId)
    .select("id")

  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: "No tienes acceso a este producto" }
  }

  return { error: null }
}
