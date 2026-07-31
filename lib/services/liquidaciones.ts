"use server"

import { createClient } from "@/lib/supabase/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { getRangoSemana, getSemanaRangoTimestamp, semanaTerminada } from "@/lib/utils/semanas"

export interface LiquidacionSemanal {
  id?: number
  emprendimiento_id: number
  razon_social_id?: number
  fecha_inicio: string // viernes (o inicio manual), YYYY-MM-DD
  fecha_fin: string    // jueves, YYYY-MM-DD
  monto_ventas: number
  monto_fletes: number
  monto_neto: number
  estado: "pendiente" | "pagado"
  fecha_pago?: string | null
  comprobante_url?: string | null
  notas?: string | null
  usuario?: string
  created_at?: string
  updated_at?: string
  // Joined
  emprendimiento_nombre?: string
}

interface MontoSemana {
  monto_ventas: number
  monto_fletes: number
}

/**
 * Calcula (sin escribir) monto_ventas y monto_fletes por emprendimiento
 * para la semana [fechaInicio, fechaInicio+6]. monto_ventas usa la misma
 * formula que el portal del emprendedor (getVentasByEmprendimiento):
 * cantidad x precio_unitario x (1 - descuentoEfectivo/100). El flete se
 * asigna completo al emprendimiento presente en la venta (en la practica
 * una venta de envio tiene un solo emprendedor); si hubiera varios se
 * asigna una sola vez por venta al primer emprendimiento encontrado en
 * sus lineas.
 */
export async function calcularLiquidacionesSemana(
  razonSocialId: number,
  fechaInicio: string
): Promise<Map<number, MontoSemana>> {
  const resultado = new Map<number, MontoSemana>()
  const supabase = createClient()
  if (!supabase) return resultado

  const { fin } = getRangoSemana(fechaInicio)
  const { start, end } = getSemanaRangoTimestamp(fechaInicio, fin)

  const buildQuery = (conEnvio: boolean) => supabase
    .from("ventas_detalle")
    .select(`
      venta_id,
      cantidad,
      precio_unitario,
      descuentodetalle,
      productos!inner(emprendimiento_id),
      ventas_encabezado!inner(fecha_venta, descuento, razon_social_id${conEnvio ? ", es_envio, valor_flete" : ""})
    `)
    .eq("ventas_encabezado.razon_social_id", razonSocialId)
    .not("productos.emprendimiento_id", "is", null)
    .gte("ventas_encabezado.fecha_venta", start)
    .lt("ventas_encabezado.fecha_venta", end)

  let { data, error } = await buildQuery(true)
  if (error && /es_envio|valor_flete/i.test(error.message || "")) {
    const retry = await buildQuery(false)
    data = retry.data
    error = retry.error
  }
  if (error) {
    console.error("[liquidaciones] Error calcularLiquidacionesSemana:", error)
    return resultado
  }

  const fletesContados = new Set<string>() // `${emprendimiento_id}-${venta_id}`

  for (const row of (data ?? []) as any[]) {
    const producto = Array.isArray(row.productos) ? row.productos[0] : row.productos
    const encabezado = Array.isArray(row.ventas_encabezado) ? row.ventas_encabezado[0] : row.ventas_encabezado
    const empId = producto?.emprendimiento_id
    if (empId == null) continue

    const descuentodetalle = Number(row.descuentodetalle ?? 0)
    const descuentoEfectivo = descuentodetalle > 0 ? descuentodetalle : Number(encabezado?.descuento ?? 0)
    const subtotal = +((row.cantidad ?? 0) * (row.precio_unitario ?? 0) * (1 - descuentoEfectivo / 100)).toFixed(2)

    const actual = resultado.get(empId) ?? { monto_ventas: 0, monto_fletes: 0 }
    actual.monto_ventas = +(actual.monto_ventas + subtotal).toFixed(2)

    const valorFlete = Number(encabezado?.valor_flete ?? 0)
    if (encabezado?.es_envio === true && valorFlete > 0) {
      const key = `${empId}-${row.venta_id}`
      if (!fletesContados.has(key)) {
        fletesContados.add(key)
        actual.monto_fletes = +(actual.monto_fletes + valorFlete).toFixed(2)
      }
    }

    resultado.set(empId, actual)
  }

  return resultado
}

/**
 * Genera (upsert, ignora duplicados) las liquidaciones 'pendiente' de la
 * semana para todos los emprendimientos activos. Regenerar la misma
 * semana NO pisa filas existentes (idempotente), sean pendientes o pagadas.
 */
export async function generarLiquidacionesSemana(
  razonSocialId: number,
  fechaInicio: string,
  usuario: string
): Promise<{ insertados: number; error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { insertados: 0, error: "Cliente admin no disponible" }

  const { data: emprendimientos, error: empError } = await supabase
    .from("emprendimientos")
    .select("id")
    .eq("razon_social_id", razonSocialId)
    .eq("activo", true)

  if (empError || !emprendimientos?.length) {
    return { insertados: 0, error: empError?.message ?? "Sin emprendimientos activos" }
  }

  const { fin } = getRangoSemana(fechaInicio)
  const montos = await calcularLiquidacionesSemana(razonSocialId, fechaInicio)

  const rows = emprendimientos.map((e) => {
    const m = montos.get(e.id) ?? { monto_ventas: 0, monto_fletes: 0 }
    return {
      razon_social_id: razonSocialId,
      emprendimiento_id: e.id,
      fecha_inicio: fechaInicio,
      fecha_fin: fin,
      monto_ventas: m.monto_ventas,
      monto_fletes: m.monto_fletes,
      monto_neto: +(m.monto_ventas - m.monto_fletes).toFixed(2),
      estado: "pendiente",
      usuario,
    }
  })

  const { data, error } = await supabase
    .from("liquidaciones_semanales")
    .upsert(rows, { onConflict: "emprendimiento_id,fecha_inicio", ignoreDuplicates: true })
    .select("id")

  if (error) {
    console.error("[liquidaciones] Error generarLiquidacionesSemana:", error)
    return { insertados: 0, error: error.message }
  }

  return { insertados: data?.length ?? 0, error: null }
}

/** Recalcula (recomputa monto_ventas/fletes/neto) SOLO si estado='pendiente'. */
export async function recalcularLiquidacion(
  id: number,
  usuario: string
): Promise<{ error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { error: "Cliente admin no disponible" }

  const { data: liq, error: getErr } = await supabase
    .from("liquidaciones_semanales")
    .select("id, razon_social_id, emprendimiento_id, fecha_inicio, estado")
    .eq("id", id)
    .single()

  if (getErr || !liq) return { error: getErr?.message ?? "Liquidacion no encontrada" }
  if (liq.estado !== "pendiente") {
    return { error: "Solo se pueden recalcular liquidaciones pendientes" }
  }

  const montos = await calcularLiquidacionesSemana(liq.razon_social_id, liq.fecha_inicio)
  const m = montos.get(liq.emprendimiento_id) ?? { monto_ventas: 0, monto_fletes: 0 }

  const { error } = await supabase
    .from("liquidaciones_semanales")
    .update({
      monto_ventas: m.monto_ventas,
      monto_fletes: m.monto_fletes,
      monto_neto: +(m.monto_ventas - m.monto_fletes).toFixed(2),
      usuario,
      updated_at: getHondurasNowISO(),
    })
    .eq("id", id)
    .eq("estado", "pendiente")

  if (error) return { error: error.message }
  return { error: null }
}

/**
 * Recalcula TODAS las liquidaciones pendientes de una semana en un solo
 * paso. Computa los montos de la semana una sola vez y actualiza cada fila
 * pendiente. Las pagadas no se tocan (historico congelado).
 */
export async function recalcularLiquidacionesSemana(
  razonSocialId: number,
  fechaInicio: string,
  usuario: string
): Promise<{ actualizadas: number; error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { actualizadas: 0, error: "Cliente admin no disponible" }

  const { data: pendientes, error: getErr } = await supabase
    .from("liquidaciones_semanales")
    .select("id, emprendimiento_id")
    .eq("razon_social_id", razonSocialId)
    .eq("fecha_inicio", fechaInicio)
    .eq("estado", "pendiente")

  if (getErr) return { actualizadas: 0, error: getErr.message }
  if (!pendientes?.length) return { actualizadas: 0, error: null }

  const montos = await calcularLiquidacionesSemana(razonSocialId, fechaInicio)
  const ahora = getHondurasNowISO()

  let actualizadas = 0
  let primerError: string | null = null

  for (const liq of pendientes) {
    const m = montos.get(liq.emprendimiento_id) ?? { monto_ventas: 0, monto_fletes: 0 }
    const { error } = await supabase
      .from("liquidaciones_semanales")
      .update({
        monto_ventas: m.monto_ventas,
        monto_fletes: m.monto_fletes,
        monto_neto: +(m.monto_ventas - m.monto_fletes).toFixed(2),
        usuario,
        updated_at: ahora,
      })
      .eq("id", liq.id)
      .eq("estado", "pendiente")

    if (error) {
      if (!primerError) primerError = error.message
      console.error("[liquidaciones] Error recalculando id", liq.id, error)
    } else {
      actualizadas++
    }
  }

  return { actualizadas, error: primerError }
}

/** Liquidaciones de una semana (vista admin), con nombre de emprendimiento. */
export async function getLiquidacionesSemana(
  razonSocialId: number,
  fechaInicio: string
): Promise<LiquidacionSemanal[]> {
  const supabase = createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("liquidaciones_semanales")
    .select(`*, emprendimientos (nombre)`)
    .eq("razon_social_id", razonSocialId)
    .eq("fecha_inicio", fechaInicio)
    .order("id", { ascending: true })

  if (error) {
    console.error("[liquidaciones] Error getLiquidacionesSemana:", error)
    return []
  }

  return (data ?? []).map((r: any) => ({
    ...r,
    emprendimiento_nombre: r.emprendimientos?.nombre ?? "",
    emprendimientos: undefined,
  }))
}

/**
 * Marca una liquidacion como pagada. Reglas de negocio (confirmadas):
 * comprobante obligatorio y solo se puede pagar una semana ya terminada
 * (fecha_fin < hoy).
 */
export async function marcarLiquidacionPagada(
  id: number,
  input: { fechaPago: string; comprobanteUrl: string | null; notas: string; usuario: string }
): Promise<{ error: string | null }> {
  if (!input.comprobanteUrl) {
    return { error: "El comprobante de pago es obligatorio" }
  }

  const supabase = createAdminClient()
  if (!supabase) return { error: "Cliente admin no disponible" }

  const { data: liq, error: getErr } = await supabase
    .from("liquidaciones_semanales")
    .select("id, fecha_fin, estado")
    .eq("id", id)
    .single()

  if (getErr || !liq) return { error: getErr?.message ?? "Liquidacion no encontrada" }
  if (!semanaTerminada(liq.fecha_fin)) {
    return { error: "Solo se puede pagar una semana ya terminada" }
  }

  const { error } = await supabase
    .from("liquidaciones_semanales")
    .update({
      estado: "pagado",
      fecha_pago: input.fechaPago,
      comprobante_url: input.comprobanteUrl,
      notas: input.notas || null,
      usuario: input.usuario,
      updated_at: getHondurasNowISO(),
    })
    .eq("id", id)

  if (error) return { error: error.message }
  return { error: null }
}

/** Revierte una liquidacion pagada a pendiente (limpia fecha/comprobante). */
export async function revertirLiquidacion(
  id: number,
  usuario: string
): Promise<{ error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { error: "Cliente admin no disponible" }

  const { error } = await supabase
    .from("liquidaciones_semanales")
    .update({
      estado: "pendiente",
      fecha_pago: null,
      comprobante_url: null,
      usuario,
      updated_at: getHondurasNowISO(),
    })
    .eq("id", id)

  if (error) return { error: error.message }
  return { error: null }
}

export interface SemanaGenerada {
  fecha_inicio: string
  fecha_fin: string
  total_liquidaciones: number
  pendientes: number
  pagadas: number
  total_neto: number
}

/**
 * Lista las semanas de liquidacion generadas (agrupadas por fecha_inicio),
 * con su rango de fechas y agregados. Ordenadas de la mas reciente a la
 * mas antigua. Sirve para el historial de liquidaciones del admin.
 */
export async function getSemanasGeneradas(
  razonSocialId: number
): Promise<SemanaGenerada[]> {
  const supabase = createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("liquidaciones_semanales")
    .select("fecha_inicio, fecha_fin, monto_neto, estado")
    .eq("razon_social_id", razonSocialId)
    .order("fecha_inicio", { ascending: false })

  if (error) {
    console.error("[liquidaciones] Error getSemanasGeneradas:", error)
    return []
  }

  // Agrupamos por fecha_inicio (una fila por semana). El orden desc de la
  // query se preserva en el orden de insercion del Map.
  const map = new Map<string, SemanaGenerada>()
  for (const r of (data ?? []) as any[]) {
    const key = r.fecha_inicio
    const cur = map.get(key) ?? {
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin,
      total_liquidaciones: 0,
      pendientes: 0,
      pagadas: 0,
      total_neto: 0,
    }
    cur.total_liquidaciones++
    if (r.estado === "pagado") cur.pagadas++
    else cur.pendientes++
    cur.total_neto = +(cur.total_neto + Number(r.monto_neto ?? 0)).toFixed(2)
    map.set(key, cur)
  }

  return [...map.values()]
}

/**
 * Elimina TODAS las liquidaciones de una semana (todas las filas con ese
 * fecha_inicio). Al borrarlas de la tabla, desaparecen tambien del portal
 * de cada emprendedor. Filtra por razon_social_id (multi-tenant).
 */
export async function eliminarLiquidacionesSemana(
  razonSocialId: number,
  fechaInicio: string
): Promise<{ eliminadas: number; error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { eliminadas: 0, error: "Cliente admin no disponible" }

  const { data, error } = await supabase
    .from("liquidaciones_semanales")
    .delete()
    .eq("razon_social_id", razonSocialId)
    .eq("fecha_inicio", fechaInicio)
    .select("id")

  if (error) return { eliminadas: 0, error: error.message }
  return { eliminadas: data?.length ?? 0, error: null }
}

/**
 * Elimina una liquidacion (pendiente o pagada). Al borrar la fila de
 * `liquidaciones_semanales`, desaparece automaticamente del portal del
 * emprendedor, que lee de la misma tabla (no hay copia por emprendedor).
 * Filtra por razon_social_id como defensa multi-tenant.
 */
export async function eliminarLiquidacion(
  id: number,
  razonSocialId: number
): Promise<{ error: string | null }> {
  const supabase = createAdminClient()
  if (!supabase) return { error: "Cliente admin no disponible" }

  const { error } = await supabase
    .from("liquidaciones_semanales")
    .delete()
    .eq("id", id)
    .eq("razon_social_id", razonSocialId)

  if (error) return { error: error.message }
  return { error: null }
}

/** Historico de liquidaciones de un emprendimiento (portal del emprendedor). */
export async function getLiquidacionesByEmprendimiento(
  emprendimientoId: number,
  limit = 26
): Promise<LiquidacionSemanal[]> {
  const supabase = createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("liquidaciones_semanales")
    .select("*")
    .eq("emprendimiento_id", emprendimientoId)
    .order("fecha_inicio", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[liquidaciones] Error getLiquidacionesByEmprendimiento:", error)
    return []
  }
  return data ?? []
}

export interface FleteSemana {
  venta_id: number
  numero_factura: string
  fecha_venta: string
  valor_flete: number
}

/** Detalle de los envios (fletes) de un emprendimiento en una semana. */
export async function getFletesSemanaEmprendimiento(
  emprendimientoId: number,
  fechaInicio: string,
  fechaFin: string
): Promise<FleteSemana[]> {
  const supabase = createClient()
  if (!supabase) return []

  const { start, end } = getSemanaRangoTimestamp(fechaInicio, fechaFin)

  const { data, error } = await supabase
    .from("ventas_detalle")
    .select(`
      venta_id,
      productos!inner(emprendimiento_id),
      ventas_encabezado!inner(numero_factura, fecha_venta, es_envio, valor_flete)
    `)
    .eq("productos.emprendimiento_id", emprendimientoId)
    .eq("ventas_encabezado.es_envio", true)
    .gte("ventas_encabezado.fecha_venta", start)
    .lt("ventas_encabezado.fecha_venta", end)

  if (error) {
    console.error("[liquidaciones] Error getFletesSemanaEmprendimiento:", error)
    return []
  }

  const porVenta = new Map<number, FleteSemana>()
  for (const row of (data ?? []) as any[]) {
    const encabezado = Array.isArray(row.ventas_encabezado) ? row.ventas_encabezado[0] : row.ventas_encabezado
    const valorFlete = Number(encabezado?.valor_flete ?? 0)
    if (valorFlete <= 0) continue
    if (!porVenta.has(row.venta_id)) {
      porVenta.set(row.venta_id, {
        venta_id: row.venta_id,
        numero_factura: encabezado?.numero_factura ?? "",
        fecha_venta: encabezado?.fecha_venta ?? "",
        valor_flete: valorFlete,
      })
    }
  }

  return [...porVenta.values()].sort((a, b) => b.fecha_venta.localeCompare(a.fecha_venta))
}
