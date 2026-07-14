"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { DENOMINACIONES_LEMPIRA, conteoVacio, totalConteo, type ConteoBilletes } from "@/lib/constants/denominaciones"

interface ConteoBilletesProps {
  value: ConteoBilletes
  onChange: (v: ConteoBilletes) => void
  compact?: boolean
}

/**
 * Conteo fisico de billetes de Lempira. Controlado por el padre: el padre
 * decide que hacer con el total (usarlo como saldo_inicial / saldo_final_real).
 * Se usa tanto en apertura como en cierre de Caja Chica.
 */
export function ConteoBilletes({ value, onChange, compact }: ConteoBilletesProps) {
  const total = totalConteo(value)

  function setCantidad(denominacion: number, cantidad: string) {
    const parsed = cantidad === "" ? 0 : parseInt(cantidad, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return
    onChange({ ...value, [String(denominacion)]: parsed })
  }

  return (
    <div className="space-y-2">
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        {DENOMINACIONES_LEMPIRA.map((denom) => {
          const cantidad = Number(value[String(denom)]) || 0
          const subtotal = denom * cantidad
          return (
            <div key={denom} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm font-medium tabular-nums">
                L {denom}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">×</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={cantidad === 0 ? "" : cantidad}
                placeholder="0"
                onChange={(e) => setCantidad(denom, e.target.value)}
                className="h-8 w-20 text-right text-sm"
              />
              <span className="flex-1 text-right text-sm tabular-nums text-muted-foreground">
                L {subtotal.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onChange(conteoVacio())}
        >
          Limpiar (recontar)
        </Button>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total contado</p>
          <p className="text-xl font-bold tabular-nums">L {total.toFixed(2)}</p>
        </div>
      </div>
    </div>
  )
}
