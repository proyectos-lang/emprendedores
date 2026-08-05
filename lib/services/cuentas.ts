import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import {
  getTenantStamp,
  isValidStamp,
  SESION_INVALIDA_ERROR,
} from "@/lib/services/tenant-stamp"
import { getHondurasNowISO } from "@/lib/utils/honduras-time"

// ==================== INTERFACES ====================

export interface CuentaConfig {
  id?: number
  nombre: string
  tipo: "Banco" | "Link_Pago" | "Otro"
  porcentaje_comision: number // 0..100
  activo?: boolean
  saldo?: number // calculado por el backend
  created_at?: string
}

export interface CuentaMovimiento {
  id?: number
  cuenta_id: number
  fecha?: string
  tipo: "Ingreso" | "Egreso"
  monto: number
  /** Monto bruto antes de descontar comisión bancaria (solo para ingresos de ventas). */
  monto_bruto?: number | null
  concepto?: string
  ref_tipo?: string
  ref_id?: number
  saldo_resultante?: number
  usuario?: string
}

/**
 * Indicador comun de "feature pendiente" cuando la tabla `cuentas_config`
 * o `cuenta_movimientos` aun no existe (migracion 011 sin aplicar). Las
 * paginas pueden mostrar un banner especifico en este caso.
 */
export const CUENTAS_FEATURE_PENDING = "feature_pending"

/**
 * Detecta SOLO cuando una de las tablas (`cuentas_config` /
 * `cuenta_movimientos`) realmente no existe en la base de datos. Distingue
 * entre tabla faltante (codigo 42P01 / PGRST205) y otros errores que
 * mencionan el nombre de la tabla en el mensaje (RLS, columna inexistente,
 * tipo invalido, etc.) que NO deben encender el banner de "feature pendiente".
 */
function isMissingTableError(
  err: { message?: string; code?: string } | null
): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  const msg = (err.message || "").toLowerCase()
  // Solo el patron canonico de Postgres: 'relation "X" does not exist'
  return /relation\s+"?(?:public\.)?(?:cuentas_config|cuenta_movimientos)"?\s+does not exist/.test(
    msg
  )
}

// ==================== CRUD CUENTAS ====================

export async function getCuentas(): Promise<{
  data: CuentaConfig[]
  error: string | null
}> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  try {
    // La columna real en BD es `comision_porcentaje`. El alias de PostgREST
    // (sintaxis: alias:columna) la entrega como `porcentaje_comision` en
    // el cliente, que es como la conoce el resto del frontend.
    const { data, error } = await supabase
      .from("cuentas_config")
      .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
      .order("id", { ascending: true })

    if (error) {
      if (isMissingTableError(error)) {
        return { data: [], error: CUENTAS_FEATURE_PENDING }
      }
      return { data: [], error: error.message }
    }
    return { data: (data || []) as CuentaConfig[], error: null }
  } catch (err) {
    console.error("[Supabase] Error obteniendo cuentas:", err)
    return { data: [], error: "Error de conexion" }
  }
}

export async function getCuentaById(
  id: number
): Promise<{ data: CuentaConfig | null; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const { data, error } = await supabase
    .from("cuentas_config")
    .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
    .eq("id", id)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CuentaConfig, error: null }
}

export async function saveCuenta(
  cuenta: CuentaConfig,
  isNew: boolean
): Promise<{ data: CuentaConfig | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    const cuentas: CuentaConfig[] = saved ? JSON.parse(saved) : []
    if (isNew) {
      const nueva = { ...cuenta, id: Date.now(), saldo: 0 }
      cuentas.push(nueva)
      localStorage.setItem("cuentas_config", JSON.stringify(cuentas))
      return { data: nueva, error: null }
    } else {
      const idx = cuentas.findIndex((c) => c.id === cuenta.id)
      if (idx >= 0) cuentas[idx] = { ...cuentas[idx], ...cuenta }
      localStorage.setItem("cuentas_config", JSON.stringify(cuentas))
      return { data: cuentas[idx] ?? cuenta, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  if (isNew) {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      return { data: null, error: SESION_INVALIDA_ERROR }
    }
    // Mapeamos el campo del frontend (`porcentaje_comision`) a la columna
    // real de la BD (`comision_porcentaje`). Tambien excluimos `saldo`
    // del payload: la BD pone 0 por default y el saldo lo gobierna el
    // motor de movimientos.
    const { id: _omit, saldo: _s, porcentaje_comision, ...rest } = cuenta
    const insertPayload = {
      ...rest,
      comision_porcentaje: porcentaje_comision ?? 0,
      ...stamp,
    }
    const { data, error } = await supabase
      .from("cuentas_config")
      .insert(insertPayload)
      .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
      .single()
    if (error) {
      if (isMissingTableError(error)) {
        return { data: null, error: CUENTAS_FEATURE_PENDING }
      }
      return { data: null, error: error.message }
    }
    return { data: data as CuentaConfig, error: null }
  }

  // Update: jamas tocamos razon_social_id ni saldo (este lo gobierna el motor
  // de movimientos). Solo nombre, tipo, comision y activo.
  const updatePayload = {
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    comision_porcentaje: cuenta.porcentaje_comision,
    activo: cuenta.activo ?? true,
  }
  const { data, error } = await supabase
    .from("cuentas_config")
    .update(updatePayload)
    .eq("id", cuenta.id)
    .select("id, nombre, tipo, activo, saldo, created_at, porcentaje_comision:comision_porcentaje")
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CuentaConfig, error: null }
}

export async function deleteCuenta(
  id: number
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem("cuentas_config")
    const cuentas: CuentaConfig[] = saved ? JSON.parse(saved) : []
    const filtered = cuentas.filter((c) => c.id !== id)
    localStorage.setItem("cuentas_config", JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: "Cliente no disponible" }

  const { error } = await supabase
    .from("cuentas_config")
    .delete()
    .eq("id", id)
  if (error) {
    // Foreign key violation: la cuenta tiene movimientos.
    if (/foreign key|violates/i.test(error.message)) {
      return {
        success: false,
        error:
          "No se puede eliminar: la cuenta tiene movimientos asociados. Desactivela en lugar de eliminar.",
      }
    }
    return { success: false, error: error.message }
  }
  return { success: true, error: null }
}

// ==================== MOVIMIENTOS ====================

/**
 * Registra un movimiento en la cuenta y actualiza su saldo running.
 * No es una transaccion atomica de Postgres (Supabase REST no expone tx),
 * pero el orden minimiza estados inconsistentes:
 *   1. SELECT saldo actual
 *   2. Calcula saldo_resultante
 *   3. INSERT movimiento con saldo_resultante
 *   4. UPDATE cuentas_config.saldo
 *
 * Si (4) falla, el movimiento queda pero el saldo cacheado en cuentas_config
 * queda desactualizado. Se puede reconciliar con `recalcSaldoCuenta(id)`.
 */
export async function registrarMovimientoCuenta(input: {
  cuenta_id: number
  tipo: "Ingreso" | "Egreso"
  monto: number
  /** Monto bruto antes de comisión. Solo para ingresos de ventas bancarias. */
  monto_bruto?: number | null
  concepto?: string
  ref_tipo?: string
  ref_id?: number
}): Promise<{ data: CuentaMovimiento | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: "Cliente no disponible" }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: "Cliente no disponible" }

  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) {
    return { data: null, error: SESION_INVALIDA_ERROR }
  }

  // 1. Saldo actual
  const { data: cuenta, error: cErr } = await supabase
    .from("cuentas_config")
    .select("saldo")
    .eq("id", input.cuenta_id)
    .single()
  if (cErr) {
    if (isMissingTableError(cErr)) {
      return { data: null, error: CUENTAS_FEATURE_PENDING }
    }
    return { data: null, error: cErr.message }
  }

  const saldoActual = Number(cuenta?.saldo ?? 0)
  const delta = input.tipo === "Ingreso" ? input.monto : -input.monto
  const saldoResultante = +(saldoActual + delta).toFixed(2)

  // 2. INSERT movimiento
  const { data: mov, error: mErr } = await supabase
    .from("cuenta_movimientos")
    .insert({
      cuenta_id: input.cuenta_id,
      tipo: input.tipo,
      monto: input.monto,
      monto_bruto: input.monto_bruto ?? null,
      concepto: input.concepto,
      ref_tipo: input.ref_tipo,
      ref_id: input.ref_id,
      saldo_resultante: saldoResultante,
      fecha: getHondurasNowISO(),
      ...stamp,
    })
    .select()
    .single()
  if (mErr) {
    if (isMissingTableError(mErr)) {
      return { data: null, error: CUENTAS_FEATURE_PENDING }
    }
    return { data: null, error: mErr.message }
  }

  // 3. UPDATE saldo cacheado
  await supabase
    .from("cuentas_config")
    .update({ saldo: saldoResultante })
    .eq("id", input.cuenta_id)

  return { data: mov as CuentaMovimiento, error: null }
}

/**
 * Recalcula `saldo_resultante` de todos los movimientos de una cuenta en
 * orden cronologico (fecha, id) y sincroniza el saldo cacheado en
 * `cuentas_config`. Necesario tras eliminar movimientos intermedios (ej.
 * al borrar una venta pagada por banco) para que tanto la cadena de saldos
 * como el saldo mostrado de la cuenta vuelvan a cuadrar. `monto` se guarda
 * positivo y el signo lo determina el tipo (Ingreso +, Egreso -).
 */
export async function recomputarSaldosCuenta(cuenta_id: number): Promise<void> {
  const supabase = createClient()
  if (!supabase) return
  const stamp = await getTenantStamp(supabase)
  if (!isValidStamp(stamp)) return

  const { data: movs, error } = await supabase
    .from("cuenta_movimientos")
    .select("id, tipo, monto, saldo_resultante")
    .eq("cuenta_id", cuenta_id)
    .eq("razon_social_id", stamp.razon_social_id)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true })

  if (error || !movs) return

  let saldo = 0
  for (const m of movs as Array<{ id: number; tipo: string; monto: number; saldo_resultante: number }>) {
    const signed = m.tipo === "Ingreso" ? Number(m.monto || 0) : -Number(m.monto || 0)
    saldo = +(saldo + signed).toFixed(2)
    if (+Number(m.saldo_resultante).toFixed(2) !== saldo) {
      await supabase
        .from("cuenta_movimientos")
        .update({ saldo_resultante: saldo })
        .eq("id", m.id)
        .eq("razon_social_id", stamp.razon_social_id)
    }
  }

  // Sincronizar el saldo cacheado de la cuenta con el saldo real recomputado.
  await supabase
    .from("cuentas_config")
    .update({ saldo })
    .eq("id", cuenta_id)
    .eq("razon_social_id", stamp.razon_social_id)
}

export async function getMovimientosCuenta(
  cuenta_id: number,
  limit = 200
): Promise<{ data: CuentaMovimiento[]; error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { data: [], error: "Cliente no disponible" }

  const { data, error } = await supabase
    .from("cuenta_movimientos")
    .select("*")
    .eq("cuenta_id", cuenta_id)
    .order("fecha", { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: error.message }
  return { data: data || [], error: null }
}
