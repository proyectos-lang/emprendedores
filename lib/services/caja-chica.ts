import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import {
  getTenantStamp,
  isValidStamp,
  SESION_INVALIDA_ERROR,
} from "@/lib/services/tenant-stamp"
import { registrarMovimientoCuenta } from "@/lib/services/cuentas"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"
import { totalConteo, type ConteoBilletes } from "@/lib/constants/denominaciones"

// ==================== INTERFACES ====================

export type CajaSesionEstado = "Abierta" | "Cerrada"

export interface CajaSesion {
  id?: number
  fecha_apertura?: string
  saldo_inicial: number
  fecha_cierre?: string | null
  saldo_final_real?: number | null
  saldo_final_calculado?: number | null
  diferencia?: number | null
  estado: CajaSesionEstado
  usuario_apertura?: string
  usuario_cierre?: string | null
  created_at?: string
}

export type CajaMovimientoTipo =
  | "Apertura"
  | "Ingreso_Manual"
  | "Ingreso_Venta"
  | "Salida"
  | "Transferencia_Banco"
  | "Cierre"

export interface CajaMovimiento {
  id?: number
  sesion_id: number
  /**
   * `fecha` (legacy) y `created_at` (timestamptz, autogestionado) suelen
   * contener el mismo valor desde el ultimo refactor. La UI del historial
   * se ordena y muestra por `created_at` para alinearse con la
   * convencion timestamptz; `fecha` se mantiene como respaldo de lectura
   * para registros antiguos.
   */
  fecha?: string
  created_at?: string
  tipo: CajaMovimientoTipo
  /** Positivo = entrada de efectivo, Negativo = salida */
  monto: number
  concepto?: string
  ref_tipo?: string
  ref_id?: number
  cuenta_destino_id?: number | null
  saldo_resultante?: number
  usuario?: string
}

/**
 * Resumen agregado por sesion (lo que devuelve la vista
 * `vista_historico_caja_chica`). Una fila = una sesion (abierta o cerrada).
 * Los totales de ingresos/egresos son "del dia" — no incluyen apertura ni
 * el movimiento sintetico de cierre.
 */
export interface CajaSesionHistorico {
  sesion_id: number
  razon_social_id: number
  fecha_apertura: string
  fecha_cierre: string | null
  usuario_apertura: string | null
  usuario_cierre: string | null
  estado: CajaSesionEstado
  saldo_inicial: number
  total_ingresos: number
  total_egresos: number
  saldo_final_calculado: number | null
  saldo_final_real: number | null
  diferencia: number | null
}

/** Conteo fisico de billetes persistido en `caja_chica_conteos` (migracion 022). */
export interface CajaConteo {
  id?: number
  sesion_id: number
  tipo: "Apertura" | "Cierre"
  detalle: ConteoBilletes
  total: number
  usuario?: string
  created_at?: string
}

export const CAJA_FEATURE_PENDING = "feature_pending"

function isMissingTableError(err: { message?: string } | null): boolean {
  if (!err?.message) return false
  return /relation .*(caja_chica_sesiones|caja_chica_movimientos).* does not exist|caja_chica_sesiones|caja_chica_movimientos/i
    .test(err.message)
}

/**
 * Guarda (upsert) el conteo de billetes de una sesion. Best-effort: si la
 * tabla `caja_chica_conteos` aun no existe (migracion 022 pendiente), no
 * bloquea la apertura/cierre — solo deja de persistir el detalle.
 */
async function guardarConteo(
  sesion_id: number,
  tipo: "Apertura" | "Cierre",
  detalle: ConteoBilletes,
  usuario?: string | null
): Promise<void> {
  const supabase = createClient()
  if (!supabase) return
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return

  const { error } = await supabase
    .from("caja_chica_conteos")
    .upsert(
      {
        sesion_id,
        tipo,
        detalle,
        total: totalConteo(detalle),
        usuario: usuario ?? stamp.usuario,
        razon_social_id: stamp.razon_social_id,
      },
      { onConflict: "sesion_id,tipo" }
    )

  if (error && !/caja_chica_conteos/i.test(error.message || "")) {
    console.warn("[caja-chica] No se pudo guardar el conteo de billetes:", error.message)
  }
}

// ==================== SESIONES ====================

/**
 * Devuelve la sesion abierta de la razon_social actual o null si no hay.
 * Las paginas la usan para gating de UI y para validar el registro de
 * efectivo en Nueva Venta.
 */
export async function getSesionAbierta(): Promise<{
  data: CajaSesion | null
  error: string | null
}> {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem("caja_sesion_abierta")
    return { data: raw ? JSON.parse(raw) : null, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  // El cliente espera `fecha_apertura`, pero la tabla solo tiene
  // `created_at` (timestamptz). Lo exponemos con alias de PostgREST.
  const { data, error } = await supabase
    .from("caja_chica_sesiones")
    .select(
      "id, razon_social_id, saldo_inicial, saldo_final_real, saldo_final_calculado, diferencia, estado, usuario_apertura, usuario_cierre, fecha_apertura:created_at, created_at"
    )
    .eq("estado", "Abierta")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) {
      return { data: null, error: CAJA_FEATURE_PENDING }
    }
    return { data: null, error: error.message }
  }
  return { data: (data as CajaSesion) || null, error: null }
}

export async function abrirSesion(
  saldo_inicial: number,
  conteo?: ConteoBilletes
): Promise<{ data: CajaSesion | null; error: string | null }> {
  if (saldo_inicial < 0) {
    return { data: null, error: "El saldo inicial no puede ser negativo" }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  // Verificacion soft: aunque hay UNIQUE INDEX parcial, devolvemos un mensaje
  // claro si ya existe una sesion abierta antes de intentar el INSERT.
  const { data: existente } = await supabase
    .from("caja_chica_sesiones")
    .select("id")
    .eq("estado", "Abierta")
    .limit(1)
    .maybeSingle()
  if (existente) {
    return { data: null, error: "Ya existe una sesion de caja abierta" }
  }

  // Forzamos `created_at` con hora de Honduras (UTC-6 codificado como ISO).
  // Esto hace que al inspeccionar la BD directamente, el usuario vea la
  // fecha/hora operativa de HN — no la UTC real. La columna `fecha_apertura`
  // se expone como alias de `created_at` para consumidores.
  const nowHN = getHondurasNowISO()
  const { data: sesion, error: sErr } = await supabase
    .from("caja_chica_sesiones")
    .insert({
      saldo_inicial,
      estado: "Abierta",
      usuario_apertura: stamp.usuario,
      razon_social_id: stamp.razon_social_id,
      created_at: nowHN,
    })
    .select(
      "id, razon_social_id, saldo_inicial, saldo_final_real, saldo_final_calculado, diferencia, estado, usuario_apertura, usuario_cierre, fecha_apertura:created_at, created_at"
    )
    .single()
  if (sErr) {
    if (isMissingTableError(sErr)) {
      return { data: null, error: CAJA_FEATURE_PENDING }
    }
    return { data: null, error: sErr.message }
  }

  // Movimiento de apertura: saldo_resultante = saldo_inicial.
  await supabase
    .from("caja_chica_movimientos")
    .insert({
      sesion_id: sesion.id,
      tipo: "Apertura",
      monto: saldo_inicial,
      concepto: "Apertura de caja",
      saldo_resultante: saldo_inicial,
      usuario: stamp.usuario,
      razon_social_id: stamp.razon_social_id,
      fecha: nowHN,
      created_at: nowHN,
    })

  if (conteo && sesion?.id) {
    await guardarConteo(sesion.id, "Apertura", conteo, stamp.usuario)
  }

  return { data: sesion as CajaSesion, error: null }
}

export async function cerrarSesion(input: {
  sesion_id: number
  saldo_final_real: number
  conteo?: ConteoBilletes
}): Promise<{ data: CajaSesion | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  // Saldo calculado = ultimo saldo_resultante de la sesion.
  const saldoCalculado = await getSaldoActual(input.sesion_id)
  const diferencia = +(input.saldo_final_real - saldoCalculado).toFixed(2)

  // Movimiento de cierre. Forzamos fecha/created_at en hora Honduras.
  const nowHN = getHondurasNowISO()
  await supabase
    .from("caja_chica_movimientos")
    .insert({
      sesion_id: input.sesion_id,
      tipo: "Cierre",
      monto: 0,
      concepto: `Cierre de caja (real: L ${input.saldo_final_real.toFixed(2)}, calc: L ${saldoCalculado.toFixed(2)})`,
      saldo_resultante: saldoCalculado,
      fecha: nowHN,
      created_at: nowHN,
      usuario: stamp.usuario,
      razon_social_id: stamp.razon_social_id,
    })

  // Update sesion. La tabla `caja_chica_sesiones` no tiene una columna
  // `fecha_cierre`: la derivamos cuando se necesita desde el `fecha`
  // (timestamp) del movimiento sintetico `Cierre` que ya insertamos arriba.
  // Persistir el cierre solo cambia el estado + saldos + usuario_cierre.
  const { data, error } = await supabase
    .from("caja_chica_sesiones")
    .update({
      estado: "Cerrada",
      saldo_final_real: input.saldo_final_real,
      saldo_final_calculado: saldoCalculado,
      diferencia,
      usuario_cierre: stamp.usuario,
    })
    .eq("id", input.sesion_id)
    .select("id, razon_social_id, saldo_inicial, saldo_final_real, saldo_final_calculado, diferencia, estado, usuario_apertura, usuario_cierre, fecha_apertura:created_at, created_at")
    .single()

  if (error) return { data: null, error: error.message }

  if (input.conteo) {
    await guardarConteo(input.sesion_id, "Cierre", input.conteo, stamp.usuario)
  }

  return { data: data as CajaSesion, error: null }
}

// ==================== MOVIMIENTOS ====================

/** Saldo actual de una sesion (= saldo_resultante del ultimo movimiento). */
async function getSaldoActual(sesion_id: number): Promise<number> {
  const supabase = createClient()
  if (!supabase) return 0
  const { data } = await supabase
    .from("caja_chica_movimientos")
    .select("saldo_resultante")
    .eq("sesion_id", sesion_id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()
  return Number(data?.saldo_resultante ?? 0)
}

/**
 * Helper publico: devuelve saldo actual de la sesion abierta o 0 si no hay.
 * Util para banners/cards de saldo en la UI.
 */
export async function getSaldoActualSesionAbierta(): Promise<number> {
  const { data: sesion } = await getSesionAbierta()
  if (!sesion?.id) return 0
  return getSaldoActual(sesion.id)
}

/**
 * Registra un movimiento en la sesion abierta. El campo `monto` debe ser
 * SIEMPRE positivo (la funcion aplica el signo segun `tipo`):
 *   - Ingreso_Manual / Ingreso_Venta / Apertura -> +monto
 *   - Salida / Transferencia_Banco              -> -monto
 *   - Cierre                                     -> 0 (manejado por cerrarSesion)
 *
 * Si `tipo === 'Transferencia_Banco'` y `cuenta_destino_id` esta presente,
 * tambien crea un Ingreso correspondiente en la cuenta bancaria destino.
 */
export async function registrarMovimientoCaja(input: {
  tipo: Exclude<CajaMovimientoTipo, "Apertura" | "Cierre">
  monto: number
  concepto?: string
  ref_tipo?: string
  ref_id?: number
  cuenta_destino_id?: number | null
}): Promise<{ data: CajaMovimiento | null; error: string | null }> {
  if (input.monto <= 0) {
    return { data: null, error: "El monto debe ser mayor a 0" }
  }
  if (input.tipo === "Transferencia_Banco" && !input.cuenta_destino_id) {
    return {
      data: null,
      error: "Transferencia a Banco requiere cuenta destino",
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  const { data: sesion, error: sErr } = await getSesionAbierta()
  if (sErr) return { data: null, error: sErr }

  // Salidas y transferencias requieren sesion activa (control de saldo).
  // Ingresos (ventas en efectivo, ingresos manuales) se registran siempre,
  // incluso sin sesion abierta, para que el cierre diario los capture.
  const esEntrada = input.tipo === "Ingreso_Manual" || input.tipo === "Ingreso_Venta"
  const necesitaSesion = !esEntrada
  if (necesitaSesion && !sesion?.id) {
    return { data: null, error: "No hay sesion de caja abierta" }
  }

  const sesionId: number | null = sesion?.id ?? null
  const saldoActual = sesionId != null ? await getSaldoActual(sesionId) : 0
  const delta = esEntrada ? input.monto : -input.monto
  const saldoResultante = +(saldoActual + delta).toFixed(2)

  // Validacion: salida no puede dejar saldo negativo (solo aplica con sesion).
  if (!esEntrada && saldoResultante < 0) {
    return {
      data: null,
      error: `Saldo insuficiente. Disponible: L ${saldoActual.toFixed(2)}`,
    }
  }

  // Hora Honduras (UTC-6 codificada como ISO) para que la BD muestre la
  // fecha operativa del dia HN al inspeccionarla directamente.
  const nowHN = getHondurasNowISO()
  console.log("[v0][caja-chica] registrarMovimientoCaja insert:", {
    sesion_id: sesionId,
    tipo: input.tipo,
    delta,
    saldoResultante,
    razon_social_id: stamp.razon_social_id,
    fecha: nowHN,
  })
  const { data: mov, error: mErr } = await supabase
    .from("caja_chica_movimientos")
    .insert({
      sesion_id: sesionId,
      tipo: input.tipo,
      monto: delta, // guardamos con signo segun convencion del schema
      concepto: input.concepto,
      ref_tipo: input.ref_tipo,
      ref_id: input.ref_id,
      cuenta_destino_id: input.cuenta_destino_id ?? null,
      saldo_resultante: saldoResultante,
      usuario: stamp.usuario,
      razon_social_id: stamp.razon_social_id,
      fecha: nowHN,
      created_at: nowHN,
    })
    .select()
    .single()
  if (mErr) {
    console.log("[v0][caja-chica] registrarMovimientoCaja error:", mErr)
    if (isMissingTableError(mErr)) {
      return { data: null, error: CAJA_FEATURE_PENDING }
    }
    return { data: null, error: mErr.message }
  }
  console.log("[v0][caja-chica] registrarMovimientoCaja success id:", mov?.id)

  // Si es transferencia a banco, espejamos un Ingreso en la cuenta destino.
  if (
    input.tipo === "Transferencia_Banco" &&
    input.cuenta_destino_id
  ) {
    await registrarMovimientoCuenta({
      cuenta_id: input.cuenta_destino_id,
      tipo: "Ingreso",
      monto: input.monto,
      concepto: input.concepto || "Transferencia desde Caja Chica",
      ref_tipo: "caja_chica_mov",
      ref_id: mov.id,
    })
  }

  return { data: mov as CajaMovimiento, error: null }
}

export async function getMovimientosSesion(
  sesion_id: number,
  limit = 500,
  // 'desc' (default) -> mas reciente arriba (pestaña "actual").
  // 'asc'            -> Apertura -> ... -> Cierre (modal de sesion cerrada).
  order: "asc" | "desc" = "desc"
): Promise<{ data: CajaMovimiento[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  // Defensa en profundidad: aunque las RLS y el stamp ya aislan por
  // razon_social_id, agregamos un filtro explicito para evitar leaks si
  // un sesion_id se inyecta cruzado entre tenants.
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: [], error: SESION_INVALIDA_ERROR }
  }

  const asc = order === "asc"
  console.log("[v0][caja-chica] getMovimientosSesion query:", {
    sesion_id,
    razon_social_id: stamp.razon_social_id,
    order,
    limit,
  })
  // Ordenamos por `created_at` (timestamptz, autogestionado por Postgres
  // via DEFAULT now() y/o por el insert con hora HN). Es la fuente de
  // verdad temporal del movimiento; `fecha` es legacy y se conserva por
  // compatibilidad con registros viejos.
  const { data, error } = await supabase
    .from("caja_chica_movimientos")
    .select("*")
    .eq("sesion_id", sesion_id)
    .eq("razon_social_id", stamp.razon_social_id)
    .order("created_at", { ascending: asc })
    .order("id", { ascending: asc })
    .limit(limit)
  console.log("[v0][caja-chica] getMovimientosSesion result:", {
    count: data?.length ?? 0,
    error: error?.message ?? null,
  })

  if (error) {
    if (isMissingTableError(error)) {
      return { data: [], error: CAJA_FEATURE_PENDING }
    }
    return { data: [], error: error.message }
  }
  return { data: data || [], error: null }
}

/**
 * Lee el historico de sesiones (vista `vista_historico_caja_chica`) para la
 * razon_social actual. Ordenado por fecha_apertura DESC (mas reciente arriba).
 * Si la vista aun no existe (script 016 pendiente), devuelve un fallback
 * calculado a partir de la tabla de sesiones (sin totales de movimientos).
 */
export async function getHistoricoSesiones(
  limit = 100
): Promise<{ data: CajaSesionHistorico[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: [], error: SESION_INVALIDA_ERROR }
  }

  // Intento principal: lee la vista (con totales agregados).
  const { data, error } = await supabase
    .from("vista_historico_caja_chica")
    .select("*")
    .eq("razon_social_id", stamp.razon_social_id)
    .order("fecha_apertura", { ascending: false })
    .limit(limit)

  if (!error) {
    return { data: (data as CajaSesionHistorico[]) || [], error: null }
  }

  // Si la base de datos aun no tiene la vista 016, degradamos a un
  // listado simple de sesiones (sin totales). El resto de la pagina sigue
  // funcionando; solo Ingresos/Egresos se muestran en 0.
  if (isMissingTableError(error) || /vista_historico_caja_chica/i.test(error.message || "")) {
    // Importante: la tabla no tiene `fecha_apertura`/`fecha_cierre`. Usamos
    // `created_at` (alias) como apertura y derivamos `fecha_cierre` desde
    // el ultimo movimiento de tipo 'Cierre' de cada sesion.
    const fallback = await supabase
      .from("caja_chica_sesiones")
      .select(
        "id, razon_social_id, saldo_inicial, saldo_final_real, saldo_final_calculado, diferencia, estado, usuario_apertura, usuario_cierre, fecha_apertura:created_at"
      )
      .eq("razon_social_id", stamp.razon_social_id)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (fallback.error) {
      if (isMissingTableError(fallback.error)) {
        return { data: [], error: CAJA_FEATURE_PENDING }
      }
      return { data: [], error: fallback.error.message }
    }

    const sesiones = (fallback.data || []) as Array<
      CajaSesion & { fecha_apertura: string }
    >
    const sesionIds = sesiones.map((s) => s.id!).filter(Boolean)

    // Una unica query a movimientos de Cierre para todas las sesiones.
    const cierreByIdMap = new Map<number, string>()
    if (sesionIds.length > 0) {
      const { data: cierres } = await supabase
        .from("caja_chica_movimientos")
        .select("sesion_id, fecha")
        .in("sesion_id", sesionIds)
        .eq("tipo", "Cierre")
        .order("id", { ascending: false })
      for (const c of (cierres || []) as Array<{ sesion_id: number; fecha: string }>) {
        // El primer registro por sesion (id desc) es el cierre mas reciente.
        if (!cierreByIdMap.has(c.sesion_id)) {
          cierreByIdMap.set(c.sesion_id, c.fecha)
        }
      }
    }

    const rows: CajaSesionHistorico[] = sesiones.map((s) => ({
      sesion_id: s.id!,
      razon_social_id: stamp.razon_social_id as number,
      fecha_apertura: s.fecha_apertura ?? "",
      fecha_cierre:
        s.estado === "Cerrada" ? cierreByIdMap.get(s.id!) ?? null : null,
      usuario_apertura: s.usuario_apertura ?? null,
      usuario_cierre: s.usuario_cierre ?? null,
      estado: s.estado,
      saldo_inicial: Number(s.saldo_inicial ?? 0),
      total_ingresos: 0,
      total_egresos: 0,
      saldo_final_calculado: s.saldo_final_calculado ?? null,
      saldo_final_real: s.saldo_final_real ?? null,
      diferencia: s.diferencia ?? null,
    }))
    return { data: rows, error: null }
  }

  return { data: [], error: error.message }
}

/** Shortcut: el modulo de Nueva Venta lo usa para validar Efectivo. */
export async function puedeRegistrarVentaEfectivo(): Promise<boolean> {
  const { data } = await getSesionAbierta()
  return !!data?.id
}

/**
 * Conteos de billetes (apertura/cierre) de una sesion, para mostrarlos en
 * el detalle del historico. Devuelve null en cada slot si no se guardo
 * conteo (ej. sesiones creadas antes de la migracion 022) o si la tabla
 * aun no existe.
 */
export async function getConteosSesion(
  sesion_id: number
): Promise<{ apertura: CajaConteo | null; cierre: CajaConteo | null }> {
  const supabase = createClient()
  if (!supabase) return { apertura: null, cierre: null }

  const { data, error } = await supabase
    .from("caja_chica_conteos")
    .select("*")
    .eq("sesion_id", sesion_id)

  if (error || !data) return { apertura: null, cierre: null }

  const rows = data as CajaConteo[]
  return {
    apertura: rows.find((r) => r.tipo === "Apertura") ?? null,
    cierre: rows.find((r) => r.tipo === "Cierre") ?? null,
  }
}
