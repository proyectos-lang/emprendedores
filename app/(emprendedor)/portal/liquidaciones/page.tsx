"use client"

import * as React from "react"
import { useEmprendedorAuth } from "@/lib/contexts/emprendedor-auth-context"
import {
  getLiquidacionesByEmprendimiento,
  getFletesSemanaEmprendimiento,
  type LiquidacionSemanal,
  type FleteSemana,
} from "@/lib/services/liquidaciones"
import { getVentasByEmprendimiento, type VentaEmprendedor } from "@/lib/services/ventas"
import { formatRango } from "@/lib/utils/semanas"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Banknote, Truck, ImageIcon } from "lucide-react"

function fmoney(n: number) {
  return "L " + new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function LiquidacionesEmprendedorPage() {
  const { emprendedor } = useEmprendedorAuth()
  const [liquidaciones, setLiquidaciones] = React.useState<LiquidacionSemanal[]>([])
  const [loading, setLoading] = React.useState(true)

  const [verComprobante, setVerComprobante] = React.useState<string | null>(null)

  const [detalleLiq, setDetalleLiq] = React.useState<LiquidacionSemanal | null>(null)
  const [detalleVentas, setDetalleVentas] = React.useState<VentaEmprendedor[]>([])
  const [detalleFletes, setDetalleFletes] = React.useState<FleteSemana[]>([])
  const [loadingDetalle, setLoadingDetalle] = React.useState(false)

  React.useEffect(() => {
    if (!emprendedor) return
    setLoading(true)
    getLiquidacionesByEmprendimiento(emprendedor.emprendimientoId).then((data) => {
      setLiquidaciones(data)
      setLoading(false)
    })
  }, [emprendedor])

  const abrirDetalle = async (liq: LiquidacionSemanal) => {
    setDetalleLiq(liq)
    setDetalleVentas([])
    setDetalleFletes([])
    setLoadingDetalle(true)
    try {
      const [ventas, fletes] = await Promise.all([
        getVentasByEmprendimiento(liq.emprendimiento_id, `${liq.fecha_inicio}T00:00:00.000Z`, `${liq.fecha_fin}T23:59:59.999Z`),
        getFletesSemanaEmprendimiento(liq.emprendimiento_id, liq.fecha_inicio, liq.fecha_fin),
      ])
      setDetalleVentas(ventas)
      setDetalleFletes(fletes)
    } finally {
      setLoadingDetalle(false)
    }
  }

  const totalPagado = liquidaciones.filter((l) => l.estado === "pagado").reduce((s, l) => s + l.monto_neto, 0)
  const totalPendiente = liquidaciones.filter((l) => l.estado === "pendiente").reduce((s, l) => s + l.monto_neto, 0)

  return (
    <div className="space-y-6 -m-4 md:-m-6 p-4 md:p-6 min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-orange-50/30">
      <div>
        <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
          <Banknote className="h-6 w-6" style={{ color: "#78350f" }} />
          Mis Liquidaciones
        </h1>
        <p className="text-stone-500 text-sm">Pagos semanales por tus ventas, con el detalle de fletes descontados</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white border border-stone-200/60 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1">Por recibir</p>
          {loading ? <Skeleton className="h-7 w-28" /> : (
            <p className="text-2xl font-extrabold text-orange-600">{fmoney(totalPendiente)}</p>
          )}
        </div>
        <div className="rounded-2xl bg-white border border-stone-200/60 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1">Recibido</p>
          {loading ? <Skeleton className="h-7 w-28" /> : (
            <p className="text-2xl font-extrabold text-emerald-700">{fmoney(totalPagado)}</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-stone-200/60 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
          </div>
        ) : liquidaciones.length === 0 ? (
          <p className="text-center text-stone-400 py-10 text-sm">Aun no tienes liquidaciones registradas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50/60">
                <TableHead className="text-stone-500">Semana</TableHead>
                <TableHead className="text-right text-stone-500">Ventas</TableHead>
                <TableHead className="text-right text-stone-500">Fletes</TableHead>
                <TableHead className="text-right text-stone-500">Neto</TableHead>
                <TableHead className="text-stone-500">Estado</TableHead>
                <TableHead className="text-stone-500"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liquidaciones.map((liq) => (
                <TableRow key={liq.id} className="hover:bg-stone-50/60 cursor-pointer" onClick={() => abrirDetalle(liq)}>
                  <TableCell className="text-sm text-stone-700">
                    {formatRango(liq.fecha_inicio, liq.fecha_fin)}
                  </TableCell>
                  <TableCell className="text-right text-stone-600">{fmoney(liq.monto_ventas)}</TableCell>
                  <TableCell className="text-right text-red-600">
                    {liq.monto_fletes > 0 ? `- ${fmoney(liq.monto_fletes)}` : fmoney(0)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-stone-800">{fmoney(liq.monto_neto)}</TableCell>
                  <TableCell>
                    {liq.estado === "pagado" ? (
                      <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200">Pagado</Badge>
                    ) : (
                      <Badge variant="outline" className="text-orange-600 border-orange-300">Pendiente</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {liq.comprobante_url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setVerComprobante(liq.comprobante_url!) }}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                      >
                        <ImageIcon className="h-3.5 w-3.5" /> Comprobante
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Dialog: Ver comprobante */}
      <Dialog open={!!verComprobante} onOpenChange={(o) => { if (!o) setVerComprobante(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Comprobante de pago</DialogTitle>
          </DialogHeader>
          {verComprobante && (
            <img src={verComprobante} alt="Comprobante de pago" className="w-full rounded-md border object-contain" />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Detalle de la semana */}
      <Dialog open={!!detalleLiq} onOpenChange={(o) => { if (!o) setDetalleLiq(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detalleLiq && formatRango(detalleLiq.fecha_inicio, detalleLiq.fecha_fin)}</DialogTitle>
          </DialogHeader>
          {loadingDetalle ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-stone-700 mb-2">Ventas de la semana</h3>
                {detalleVentas.length === 0 ? (
                  <p className="text-xs text-stone-400">Sin ventas en esta semana.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Factura</TableHead>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cant.</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalleVentas.map((v, i) => (
                          <TableRow key={`${v.venta_id}-${v.producto_id}-${i}`}>
                            <TableCell className="text-xs">
                              {v.numero_factura}
                              {v.es_credito && (
                                <Badge variant="outline" className="ml-1 text-[10px] text-blue-600 border-blue-300">Credito</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{v.producto_nombre}</TableCell>
                            <TableCell className="text-right text-xs">{v.cantidad}</TableCell>
                            <TableCell className="text-right text-xs font-medium">{fmoney(v.subtotal_neto)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium text-stone-700 mb-2 flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" /> Fletes descontados
                </h3>
                {detalleFletes.length === 0 ? (
                  <p className="text-xs text-stone-400">Sin envios en esta semana.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Factura</TableHead>
                          <TableHead className="text-right">Flete</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalleFletes.map((f) => (
                          <TableRow key={f.venta_id}>
                            <TableCell className="text-xs">{f.numero_factura}</TableCell>
                            <TableCell className="text-right text-xs text-red-600">- {fmoney(f.valor_flete)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {detalleLiq && (
                <div className="rounded-lg border p-3 bg-muted/30 flex justify-between text-sm font-semibold">
                  <span>Neto</span>
                  <span>{fmoney(detalleLiq.monto_neto)}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
