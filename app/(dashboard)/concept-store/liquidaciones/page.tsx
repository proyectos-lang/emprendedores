"use client"

import * as React from "react"
import { useAuth } from "@/lib/contexts/auth-context"
import { useTenant } from "@/lib/hooks/use-tenant"
import {
  getLiquidacionesSemana,
  generarLiquidacionesSemana,
  recalcularLiquidacion,
  recalcularLiquidacionesSemana,
  marcarLiquidacionPagada,
  marcarLiquidacionesSemanaPagadas,
  revertirLiquidacion,
  eliminarLiquidacion,
  getSemanasGeneradas,
  eliminarLiquidacionesSemana,
  calcularLiquidacionesSemana,
  getFletesSemanaEmprendimiento,
  type LiquidacionSemanal,
  type FleteSemana,
  type SemanaGenerada,
} from "@/lib/services/liquidaciones"
import { getVentasByEmprendimiento, type VentaEmprendedor } from "@/lib/services/ventas"
import {
  getRangoSemana,
  addSemanas,
  getViernesSemanaActual,
  formatRango,
  semanaTerminada,
} from "@/lib/utils/semanas"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  Truck,
  ImageIcon,
  Trash2,
} from "lucide-react"

function formatLps(n: number) {
  return `L ${n.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function uploadComprobante(file: File): Promise<{ url: string | null; error: string | null }> {
  try {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("folder", "comprobantes-liquidacion")
    const res = await fetch("/api/upload-imagen", { method: "POST", body: formData })
    const json = await res.json()
    if (!res.ok) return { url: null, error: json.error || "Error al subir el comprobante" }
    return { url: json.url, error: null }
  } catch {
    return { url: null, error: "Error subiendo el comprobante" }
  }
}

export default function LiquidacionesPage() {
  const { user } = useAuth()
  const { razonSocialId, ready } = useTenant()
  const { toast } = useToast()

  // `inicio` es la fecha de inicio de la semana seleccionada (YYYY-MM-DD).
  // Por defecto el viernes de la semana Vie-Jue actual, pero es un input
  // libre: el admin puede escribir cualquier fecha de inicio manual (util
  // para la primera liquidacion parcial que arranca a mitad de semana).
  const [inicio, setInicio] = React.useState(() => getViernesSemanaActual())
  const [liquidaciones, setLiquidaciones] = React.useState<LiquidacionSemanal[]>([])
  const [montosVivo, setMontosVivo] = React.useState<Map<number, { monto_ventas: number; monto_fletes: number }>>(new Map())
  const [loading, setLoading] = React.useState(true)
  const [generando, setGenerando] = React.useState(false)
  const [recalculandoId, setRecalculandoId] = React.useState<number | null>(null)
  const [recalculandoTodo, setRecalculandoTodo] = React.useState(false)

  // Tab activo + historial de semanas generadas
  const [tab, setTab] = React.useState<"semana" | "historial">("semana")
  const [historial, setHistorial] = React.useState<SemanaGenerada[]>([])
  const [loadingHistorial, setLoadingHistorial] = React.useState(false)

  const rango = getRangoSemana(inicio)
  const semanaEnCurso = !semanaTerminada(rango.fin)

  const cargar = React.useCallback(async () => {
    if (razonSocialId == null) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [rows, montos] = await Promise.all([
        getLiquidacionesSemana(razonSocialId, inicio),
        calcularLiquidacionesSemana(razonSocialId, inicio),
      ])
      setLiquidaciones(rows)
      setMontosVivo(montos)
    } finally {
      setLoading(false)
    }
  }, [razonSocialId, inicio])

  React.useEffect(() => {
    if (!ready) return
    cargar()
  }, [ready, cargar])

  const cargarHistorial = React.useCallback(async () => {
    if (razonSocialId == null) return
    setLoadingHistorial(true)
    try {
      setHistorial(await getSemanasGeneradas(razonSocialId))
    } finally {
      setLoadingHistorial(false)
    }
  }, [razonSocialId])

  React.useEffect(() => {
    if (!ready || razonSocialId == null) return
    if (tab === "historial") cargarHistorial()
  }, [ready, razonSocialId, tab, cargarHistorial])

  const handleGenerar = async () => {
    if (razonSocialId == null) return
    setGenerando(true)
    try {
      const { insertados, error } = await generarLiquidacionesSemana(razonSocialId, inicio, user?.nombre ?? "admin")
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
      } else {
        toast({
          title: insertados > 0 ? `${insertados} liquidaciones generadas` : "Sin liquidaciones nuevas",
          description: insertados > 0
            ? `Se generaron ${insertados} liquidaciones para la semana ${rango.label}.`
            : "Todos los emprendimientos activos ya tienen liquidacion para esta semana.",
        })
        await cargar()
      }
    } finally {
      setGenerando(false)
    }
  }

  const handleRecalcular = async (liq: LiquidacionSemanal) => {
    if (!liq.id) return
    setRecalculandoId(liq.id)
    try {
      const { error } = await recalcularLiquidacion(liq.id, user?.nombre ?? "admin")
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
      } else {
        toast({ title: "Liquidacion recalculada" })
        await cargar()
      }
    } finally {
      setRecalculandoId(null)
    }
  }

  // Confirmar pago masivo (todas las pendientes de la semana, sin comprobante).
  const [confirmarPagoTodos, setConfirmarPagoTodos] = React.useState(false)
  const [pagandoTodos, setPagandoTodos] = React.useState(false)

  const handlePagarTodos = async () => {
    if (razonSocialId == null) return
    setPagandoTodos(true)
    try {
      const { pagadas, error } = await marcarLiquidacionesSemanaPagadas(
        razonSocialId,
        inicio,
        user?.nombre ?? "admin"
      )
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
      } else {
        toast({
          title: pagadas > 0
            ? `${pagadas} liquidacion${pagadas !== 1 ? "es" : ""} marcada${pagadas !== 1 ? "s" : ""} como pagada${pagadas !== 1 ? "s" : ""}`
            : "Sin liquidaciones pendientes que pagar",
        })
        setConfirmarPagoTodos(false)
        await cargar()
      }
    } finally {
      setPagandoTodos(false)
    }
  }

  const handleRecalcularTodo = async () => {
    if (razonSocialId == null) return
    setRecalculandoTodo(true)
    try {
      const { actualizadas, error } = await recalcularLiquidacionesSemana(
        razonSocialId,
        inicio,
        user?.nombre ?? "admin"
      )
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
      } else {
        toast({
          title: actualizadas > 0
            ? `${actualizadas} liquidacion${actualizadas !== 1 ? "es" : ""} recalculada${actualizadas !== 1 ? "s" : ""}`
            : "Sin liquidaciones pendientes que recalcular",
        })
        await cargar()
      }
    } finally {
      setRecalculandoTodo(false)
    }
  }

  const handleRevertir = async (liq: LiquidacionSemanal) => {
    if (!liq.id) return
    const { error } = await revertirLiquidacion(liq.id, user?.nombre ?? "admin")
    if (error) {
      toast({ title: "Error al revertir", description: error, variant: "destructive" })
    } else {
      toast({ title: "Liquidacion revertida a pendiente" })
      await cargar()
    }
  }

  // Eliminar liquidacion (con confirmacion). Borra la fila de la tabla, por
  // lo que tambien desaparece del portal del emprendedor.
  const [liqEliminar, setLiqEliminar] = React.useState<LiquidacionSemanal | null>(null)
  const [eliminando, setEliminando] = React.useState(false)

  const handleEliminar = async () => {
    if (!liqEliminar?.id || razonSocialId == null) return
    setEliminando(true)
    try {
      const { error } = await eliminarLiquidacion(liqEliminar.id, razonSocialId)
      if (error) {
        toast({ title: "Error al eliminar", description: error, variant: "destructive" })
      } else {
        toast({ title: "Liquidacion eliminada" })
        setLiqEliminar(null)
        await cargar()
      }
    } finally {
      setEliminando(false)
    }
  }

  // Eliminar toda una semana desde el historial.
  const [semanaEliminar, setSemanaEliminar] = React.useState<SemanaGenerada | null>(null)
  const [eliminandoSemana, setEliminandoSemana] = React.useState(false)

  const handleEliminarSemana = async () => {
    if (!semanaEliminar || razonSocialId == null) return
    setEliminandoSemana(true)
    try {
      const { eliminadas, error } = await eliminarLiquidacionesSemana(razonSocialId, semanaEliminar.fecha_inicio)
      if (error) {
        toast({ title: "Error al eliminar", description: error, variant: "destructive" })
      } else {
        toast({ title: `${eliminadas} liquidacion${eliminadas !== 1 ? "es" : ""} eliminada${eliminadas !== 1 ? "s" : ""}` })
        setSemanaEliminar(null)
        await cargarHistorial()
        // Si borramos la semana que se ve en la pestaña "Por semana", refrescarla.
        if (semanaEliminar.fecha_inicio === inicio) await cargar()
      }
    } finally {
      setEliminandoSemana(false)
    }
  }

  // ----- Dialog: Registrar pago ------------------------------------------
  const [liqPagar, setLiqPagar] = React.useState<LiquidacionSemanal | null>(null)
  const [formFecha, setFormFecha] = React.useState("")
  const [formNotas, setFormNotas] = React.useState("")
  const [comprobanteFile, setComprobanteFile] = React.useState<File | null>(null)
  const [comprobantePreview, setComprobantePreview] = React.useState<string | null>(null)
  const [guardando, setGuardando] = React.useState(false)

  const abrirPagar = (liq: LiquidacionSemanal) => {
    setLiqPagar(liq)
    setFormFecha(new Date().toISOString().split("T")[0])
    setFormNotas("")
    setComprobanteFile(null)
    setComprobantePreview(null)
  }

  const handleComprobanteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setComprobanteFile(file)
    const reader = new FileReader()
    reader.onload = () => setComprobantePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handlePagar = async () => {
    if (!liqPagar?.id) return
    if (!comprobanteFile) {
      toast({ title: "Comprobante requerido", description: "Sube la imagen del comprobante de pago", variant: "destructive" })
      return
    }
    setGuardando(true)
    try {
      const { url, error: uploadError } = await uploadComprobante(comprobanteFile)
      if (uploadError || !url) {
        toast({ title: "Error subiendo comprobante", description: uploadError ?? "", variant: "destructive" })
        return
      }
      const { error } = await marcarLiquidacionPagada(liqPagar.id, {
        fechaPago: formFecha,
        comprobanteUrl: url,
        notas: formNotas,
        usuario: user?.nombre ?? "admin",
      })
      if (error) {
        toast({ title: "Error al registrar pago", description: error, variant: "destructive" })
      } else {
        toast({ title: "Pago registrado", description: `${liqPagar.emprendimiento_nombre} — ${formatLps(liqPagar.monto_neto)}` })
        setLiqPagar(null)
        await cargar()
      }
    } finally {
      setGuardando(false)
    }
  }

  // ----- Dialog: Ver comprobante ------------------------------------------
  const [verComprobante, setVerComprobante] = React.useState<string | null>(null)

  // ----- Dialog: Detalle de la semana -------------------------------------
  const [detalleLiq, setDetalleLiq] = React.useState<LiquidacionSemanal | null>(null)
  const [detalleVentas, setDetalleVentas] = React.useState<VentaEmprendedor[]>([])
  const [detalleFletes, setDetalleFletes] = React.useState<FleteSemana[]>([])
  const [loadingDetalle, setLoadingDetalle] = React.useState(false)

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

  // KPIs
  const totalPendiente = liquidaciones.filter((l) => l.estado === "pendiente").reduce((s, l) => s + l.monto_neto, 0)
  const totalPagado = liquidaciones.filter((l) => l.estado === "pagado").reduce((s, l) => s + l.monto_neto, 0)
  const cantPendientes = liquidaciones.filter((l) => l.estado === "pendiente").length

  function estaDesactualizada(liq: LiquidacionSemanal): boolean {
    if (liq.estado !== "pendiente") return false
    const vivo = montosVivo.get(liq.emprendimiento_id) ?? { monto_ventas: 0, monto_fletes: 0 }
    return (
      Math.abs(vivo.monto_ventas - liq.monto_ventas) > 0.01 ||
      Math.abs(vivo.monto_fletes - liq.monto_fletes) > 0.01
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
          <Banknote className="h-6 w-6 text-blue-600" />
          Liquidaciones Semanales
        </h1>
        <p className="text-sm text-stone-500 mt-1">
          Pago semanal (viernes-jueves) a cada emprendedor por sus ventas, menos fletes de envio
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "semana" | "historial")}>
        <TabsList>
          <TabsTrigger value="semana">Por semana</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="semana" className="space-y-6 mt-4">
        <div className="flex flex-col items-stretch sm:items-end gap-1.5">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" title="Semana anterior" onClick={() => setInicio((d) => addSemanas(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={inicio}
              onChange={(e) => { if (e.target.value) setInicio(e.target.value) }}
              className="w-40"
              title="Fecha de inicio de la semana"
            />
            <Button variant="outline" size="icon" title="Semana siguiente" onClick={() => setInicio((d) => addSemanas(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={cargar} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              onClick={handleRecalcularTodo}
              disabled={recalculandoTodo || loading || razonSocialId == null || cantPendientes === 0}
              title="Recalcular todas las liquidaciones pendientes de esta semana"
            >
              {recalculandoTodo ? <Spinner className="h-4 w-4 mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Recalcular todo
            </Button>
            <Button
              onClick={() => setConfirmarPagoTodos(true)}
              disabled={loading || razonSocialId == null || cantPendientes === 0}
              className="bg-green-600 hover:bg-green-700"
              title="Marcar como pagadas todas las liquidaciones pendientes de esta semana"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Pagar a todos
            </Button>
            <Button onClick={handleGenerar} disabled={generando || loading || razonSocialId == null}>
              {generando ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Generar semana
            </Button>
          </div>
          <p className="text-xs text-stone-500 text-center sm:text-right">
            {rango.label}
          </p>
        </div>

      {semanaEnCurso && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Esta semana aun esta en curso: los montos pueden seguir cambiando. Recalcula antes de pagar, y recuerda que solo se puede
            registrar el pago una vez que la semana haya terminado.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-stone-500 font-medium uppercase tracking-wide flex items-center gap-1">
              <Clock className="h-3 w-3 text-orange-500" /> Por pagar
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold text-orange-600">{formatLps(totalPendiente)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-stone-500 font-medium uppercase tracking-wide flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" /> Pagado
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold text-green-700">{formatLps(totalPagado)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-stone-500 font-medium uppercase tracking-wide">
              Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold text-stone-800">{cantPendientes}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-6 w-6" />
            </div>
          ) : liquidaciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-stone-400 gap-2">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm font-medium">Sin liquidaciones para la semana {rango.label}</p>
              <p className="text-xs">Haz clic en "Generar semana" para crear las liquidaciones pendientes.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Emprendimiento</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Fletes</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liquidaciones.map((liq) => (
                  <TableRow key={liq.id}>
                    <TableCell className="font-medium">
                      {liq.emprendimiento_nombre}
                      {estaDesactualizada(liq) && (
                        <Badge variant="outline" className="ml-2 text-amber-700 border-amber-300 text-[10px]">
                          Desactualizada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-stone-600">{formatLps(liq.monto_ventas)}</TableCell>
                    <TableCell className="text-right text-red-600">
                      {liq.monto_fletes > 0 ? `- ${formatLps(liq.monto_fletes)}` : formatLps(0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatLps(liq.monto_neto)}</TableCell>
                    <TableCell>
                      {liq.estado === "pagado" ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Pagado</Badge>
                      ) : (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">Pendiente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => abrirDetalle(liq)}>
                        Detalle
                      </Button>
                      {liq.estado === "pendiente" ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRecalcular(liq)}
                            disabled={recalculandoId === liq.id}
                          >
                            {recalculandoId === liq.id ? <Spinner className="h-3.5 w-3.5" /> : "Recalcular"}
                          </Button>
                          <Button size="sm" onClick={() => abrirPagar(liq)}>
                            Registrar pago
                          </Button>
                        </>
                      ) : (
                        <>
                          {liq.comprobante_url && (
                            <Button size="sm" variant="ghost" onClick={() => setVerComprobante(liq.comprobante_url!)}>
                              <ImageIcon className="h-3.5 w-3.5 mr-1" /> Comprobante
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-stone-500 hover:text-red-600"
                            onClick={() => handleRevertir(liq)}
                          >
                            Revertir
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-stone-400 hover:text-red-600"
                        onClick={() => setLiqEliminar(liq)}
                        title="Eliminar liquidacion"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ── Historial de semanas generadas ── */}
        <TabsContent value="historial" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loadingHistorial ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : historial.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-stone-400 gap-2">
                  <AlertCircle className="h-8 w-8" />
                  <p className="text-sm font-medium">Aun no se ha generado ninguna liquidacion.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Semana (inicio – fin)</TableHead>
                      <TableHead className="text-center">Liquidaciones</TableHead>
                      <TableHead className="text-center">Estado</TableHead>
                      <TableHead className="text-right">Total neto</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historial.map((s) => (
                      <TableRow key={s.fecha_inicio}>
                        <TableCell className="font-medium">
                          {formatRango(s.fecha_inicio, s.fecha_fin)}
                          <span className="block text-xs font-mono text-stone-400">
                            {s.fecha_inicio} → {s.fecha_fin}
                          </span>
                        </TableCell>
                        <TableCell className="text-center text-stone-600">{s.total_liquidaciones}</TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex gap-1 justify-center flex-wrap">
                            {s.pagadas > 0 && (
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 text-[10px]">
                                {s.pagadas} pagada{s.pagadas !== 1 ? "s" : ""}
                              </Badge>
                            )}
                            {s.pendientes > 0 && (
                              <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">
                                {s.pendientes} pendiente{s.pendientes !== 1 ? "s" : ""}
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatLps(s.total_neto)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap space-x-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setInicio(s.fecha_inicio); setTab("semana") }}
                          >
                            Ver
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-stone-400 hover:text-red-600"
                            onClick={() => setSemanaEliminar(s)}
                            title="Eliminar todas las liquidaciones de esta semana"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AlertDialog: Confirmar pago masivo */}
      <AlertDialog open={confirmarPagoTodos} onOpenChange={(o) => { if (!o) setConfirmarPagoTodos(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pago a todos</AlertDialogTitle>
            <AlertDialogDescription>
              Se marcaran como <span className="font-semibold text-stone-800">pagadas</span> las{" "}
              <span className="font-semibold text-stone-800">{cantPendientes}</span>{" "}
              liquidacion{cantPendientes !== 1 ? "es" : ""} pendiente{cantPendientes !== 1 ? "s" : ""} de la semana{" "}
              <span className="font-semibold text-stone-800">{rango.label}</span>, sin comprobante de pago.
              Cada emprendedor las vera como pagadas en su portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pagandoTodos}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handlePagarTodos() }}
              disabled={pagandoTodos}
              className="bg-green-600 hover:bg-green-700"
            >
              {pagandoTodos ? <Spinner className="h-4 w-4 mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirmar pago
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Confirmar eliminacion de una semana completa */}
      <AlertDialog open={!!semanaEliminar} onOpenChange={(o) => { if (!o) setSemanaEliminar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar liquidaciones de la semana</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminaran las{" "}
              <span className="font-semibold text-stone-800">{semanaEliminar?.total_liquidaciones}</span>{" "}
              liquidaciones de la semana{" "}
              <span className="font-semibold text-stone-800">
                {semanaEliminar && formatRango(semanaEliminar.fecha_inicio, semanaEliminar.fecha_fin)}
              </span>. Tambien desapareceran del portal de cada emprendedor.
              {semanaEliminar && semanaEliminar.pagadas > 0 && (
                <span className="block mt-2 text-red-600">
                  {semanaEliminar.pagadas} de ellas estan PAGADAS: se perderan sus registros de pago y comprobantes.
                </span>
              )}
              {" "}Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminandoSemana}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEliminarSemana() }}
              disabled={eliminandoSemana}
              className="bg-red-600 hover:bg-red-700"
            >
              {eliminandoSemana ? <Spinner className="h-4 w-4 mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Eliminar semana
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Confirmar eliminacion */}
      <AlertDialog open={!!liqEliminar} onOpenChange={(o) => { if (!o) setLiqEliminar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar liquidacion</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara la liquidacion de{" "}
              <span className="font-semibold text-stone-800">{liqEliminar?.emprendimiento_nombre}</span>{" "}
              por {liqEliminar ? formatLps(liqEliminar.monto_neto) : ""}. Tambien desaparecera del portal del
              emprendedor.
              {liqEliminar?.estado === "pagado" && (
                <span className="block mt-2 text-red-600">
                  Esta liquidacion esta marcada como PAGADA: se perdera el registro del pago y su comprobante.
                </span>
              )}
              {" "}Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEliminar() }}
              disabled={eliminando}
              className="bg-red-600 hover:bg-red-700"
            >
              {eliminando ? <Spinner className="h-4 w-4 mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: Registrar pago */}
      <Dialog open={!!liqPagar} onOpenChange={(o) => { if (!o) setLiqPagar(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pago — {liqPagar?.emprendimiento_nombre}</DialogTitle>
            <DialogDescription>
              Monto a pagar: <span className="font-semibold text-stone-800">{liqPagar ? formatLps(liqPagar.monto_neto) : ""}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="fecha-pago-liq">Fecha de pago</Label>
              <Input id="fecha-pago-liq" type="date" value={formFecha} onChange={(e) => setFormFecha(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notas-pago-liq">Notas (opcional)</Label>
              <Input
                id="notas-pago-liq"
                value={formNotas}
                onChange={(e) => setFormNotas(e.target.value)}
                placeholder="Referencia de transferencia..."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="comprobante-liq">Comprobante de pago (obligatorio)</Label>
              <Input id="comprobante-liq" type="file" accept="image/*" onChange={handleComprobanteChange} />
              {comprobantePreview && (
                <img src={comprobantePreview} alt="Comprobante" className="mt-2 max-h-48 rounded-md border object-contain" />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiqPagar(null)}>Cancelar</Button>
            <Button onClick={handlePagar} disabled={guardando || !comprobanteFile}>
              {guardando ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Confirmar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>{detalleLiq?.emprendimiento_nombre} — {rango.label}</DialogTitle>
          </DialogHeader>
          {loadingDetalle ? (
            <div className="flex justify-center py-10">
              <Spinner />
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
                          <TableHead>Observaciones</TableHead>
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
                            <TableCell className="text-xs text-stone-500 max-w-[16rem]">
                              {v.comentario ? (
                                <span className="break-words">{v.comentario}</span>
                              ) : (
                                <span className="text-stone-300">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs">{v.cantidad}</TableCell>
                            <TableCell className="text-right text-xs font-medium">{formatLps(v.subtotal_neto)}</TableCell>
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
                            <TableCell className="text-right text-xs text-red-600">- {formatLps(f.valor_flete)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {detalleLiq && (
                <div className="rounded-lg border p-3 bg-muted/30 flex justify-between text-sm font-semibold">
                  <span>Neto liquidado</span>
                  <span>{formatLps(detalleLiq.monto_neto)}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
