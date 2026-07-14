/**
 * Denominaciones de billetes de Lempira (Honduras) usadas en el conteo
 * fisico de efectivo al abrir y cerrar Caja Chica (migracion 022).
 */
export const DENOMINACIONES_LEMPIRA = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const

/** Cantidad de billetes por denominacion. Clave = denominacion como string. */
export type ConteoBilletes = Record<string, number>

export function conteoVacio(): ConteoBilletes {
  return Object.fromEntries(DENOMINACIONES_LEMPIRA.map((d) => [String(d), 0]))
}

export function totalConteo(conteo: ConteoBilletes): number {
  return +DENOMINACIONES_LEMPIRA.reduce(
    (acc, d) => acc + d * (Number(conteo[String(d)]) || 0),
    0
  ).toFixed(2)
}
