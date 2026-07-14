/**
 * Helpers de semanas (lunes-domingo) para el modulo de Liquidaciones
 * (migracion 022). Todas las fechas de "semana" son strings YYYY-MM-DD
 * (columnas DATE), tratadas en horario local — no hay conversion de zona
 * horaria involucrada como en `honduras-time.ts` (que aplica a TIMESTAMPTZ).
 */

const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const MESES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatCorto(d: Date): string {
  return `${DIAS_CORTOS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`
}

/** Lunes (YYYY-MM-DD) de la semana que contiene `fecha`. */
export function getLunesDeSemana(fecha: Date): string {
  const day = fecha.getDay() // 0=domingo .. 6=sabado
  const diffToMonday = day === 0 ? -6 : 1 - day
  const lunes = new Date(fecha)
  lunes.setDate(fecha.getDate() + diffToMonday)
  lunes.setHours(0, 0, 0, 0)
  return toISODate(lunes)
}

/** Dado el lunes de una semana, devuelve { inicio, fin, label }. */
export function getRangoSemana(lunesISO: string): { inicio: string; fin: string; label: string } {
  const lunes = parseISODate(lunesISO)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  return {
    inicio: toISODate(lunes),
    fin: toISODate(domingo),
    label: `${formatCorto(lunes)} – ${formatCorto(domingo)}`,
  }
}

/** Suma (o resta, con n negativo) `n` semanas al lunes dado. */
export function addSemanas(lunesISO: string, n: number): string {
  const lunes = parseISODate(lunesISO)
  lunes.setDate(lunes.getDate() + n * 7)
  return toISODate(lunes)
}

/** Lunes de la semana anterior completa (default del selector admin). */
export function getSemanaAnteriorLunes(): string {
  return addSemanas(getLunesDeSemana(new Date()), -1)
}

/**
 * Rango [start, end) en TIMESTAMPTZ (misma convencion de
 * `getHondurasDayRange`: hora local de Honduras codificada como UTC) para
 * filtrar `ventas_encabezado.fecha_venta` entre `inicioISO` y `finISO`
 * (ambos YYYY-MM-DD, inclusive).
 */
export function getSemanaRangoTimestamp(inicioISO: string, finISO: string): { start: string; end: string } {
  const start = `${inicioISO}T00:00:00.000Z`
  const [y, m, d] = finISO.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}T00:00:00.000Z`
  return { start, end }
}

/** true si `finISO` (YYYY-MM-DD) ya paso respecto a hoy (fecha local). */
export function semanaTerminada(finISO: string): boolean {
  return toISODate(new Date()) > finISO
}
