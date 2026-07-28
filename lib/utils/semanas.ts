/**
 * Helpers de semanas de liquidacion (migracion 022).
 *
 * La semana de liquidacion va de VIERNES a JUEVES (7 dias: Vie Sab Dom Lun
 * Mar Mie Jue). Todas las fechas son strings YYYY-MM-DD (columnas DATE),
 * tratadas en horario local — no hay conversion de zona horaria como en
 * `honduras-time.ts` (que aplica a TIMESTAMPTZ).
 *
 * `getRangoSemana` calcula el fin como el PRIMER JUEVES en o despues del
 * inicio. Asi funciona tanto para una semana estandar (inicio viernes ->
 * fin jueves, +6 dias) como para una semana parcial con inicio manual
 * (ej. inicio martes -> fin jueves, +2 dias). Esto permite arrancar la
 * primera liquidacion a mitad de semana y luego seguir el ciclo Vie-Jue.
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

/** Viernes (YYYY-MM-DD) de la semana Vie-Jue que contiene `fecha`. */
export function getViernesDeSemana(fecha: Date): string {
  // getDay: Dom=0 .. Vie=5, Sab=6. offset a retroceder hasta el viernes:
  // Vie=0, Sab=1, Dom=2, Lun=3, Mar=4, Mie=5, Jue=6  =>  (getDay + 2) % 7
  const offset = (fecha.getDay() + 2) % 7
  const viernes = new Date(fecha)
  viernes.setDate(fecha.getDate() - offset)
  viernes.setHours(0, 0, 0, 0)
  return toISODate(viernes)
}

/** Primer jueves (YYYY-MM-DD) en o despues de `inicioISO`. */
export function getProximoJueves(inicioISO: string): string {
  const inicio = parseISODate(inicioISO)
  // getDay: Jue=4. dias hasta el proximo jueves (0 si ya es jueves).
  const dias = (4 - inicio.getDay() + 7) % 7
  const jueves = new Date(inicio)
  jueves.setDate(inicio.getDate() + dias)
  return toISODate(jueves)
}

/**
 * Dado el inicio de una semana, devuelve { inicio, fin, label } donde `fin`
 * es el primer jueves en o despues del inicio (cierre de la semana Vie-Jue,
 * o cierre parcial si el inicio no es viernes).
 */
export function getRangoSemana(inicioISO: string): { inicio: string; fin: string; label: string } {
  const fin = getProximoJueves(inicioISO)
  return {
    inicio: inicioISO,
    fin,
    label: formatRango(inicioISO, fin),
  }
}

/** Etiqueta legible de un rango a partir de fechas explicitas (inicio/fin). */
export function formatRango(inicioISO: string, finISO: string): string {
  return `${formatCorto(parseISODate(inicioISO))} – ${formatCorto(parseISODate(finISO))}`
}

/** Suma (o resta, con n negativo) `n` semanas (de 7 dias) al inicio dado. */
export function addSemanas(inicioISO: string, n: number): string {
  const inicio = parseISODate(inicioISO)
  inicio.setDate(inicio.getDate() + n * 7)
  return toISODate(inicio)
}

/** Viernes de la semana Vie-Jue actual (default del selector admin). */
export function getViernesSemanaActual(): string {
  return getViernesDeSemana(new Date())
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
