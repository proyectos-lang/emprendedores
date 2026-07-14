"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  PlayCircle,
  StopCircle,
  AlertTriangle,
  ArrowRightLeft,
  History,
  Eye,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { useTenant } from "@/lib/hooks/use-tenant"
import {
  abrirSesion,
  cerrarSesion,
  registrarMovimientoCaja,
  getMovimientosSesion,
  getHistoricoSesiones,
  getConteosSesion,
  type CajaMovimiento,
  type CajaMovimientoTipo,
  type CajaSesionHistorico,
  type CajaConteo,
  CAJA_FEATURE_PENDING,
} from "@/lib/services/caja-chica"
import { DENOMINACIONES_LEMPIRA } from "@/lib/constants/denominaciones"
import { useCajaSesion } from "@/lib/hooks/use-caja-sesion"
import { getCuentas, type CuentaConfig } from "@/lib/services/cuentas"
import { ConteoBilletes as ConteoBilletesInput } from "@/components/conteo-billetes"
import { conteoVacio, totalConteo, type ConteoBilletes as ConteoBilletesType } from "@/lib/constants/denominaciones"

const ALERTA_SALDO = 5000

function formatCurrency(n: number | undefined | null): string {
  const v = Number(n ?? 0)
  return `L ${v.toLocaleString("en-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-"
  try {
    // Convencion del modulo: los timestamps de caja chica se almacenan
    // como "hora local de Honduras codificada como UTC" (ver
    // `lib/utils/honduras-time.ts`). Para mostrar usamos `timeZone: "UTC"`
    // y asi leemos los componentes tal cual sin re-aplicar offset.
    return new Date(iso).toLocaleString("es-HN", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return "-"
  try {
    return new Date(iso).toLocaleDateString("es-HN", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

const TIPO_LABEL: Record<CajaMovimientoTipo, string> = {
  Apertura: "Apertura",
  Ingreso_Manual: "Ingreso Manual",
  Ingreso_Venta: "Ingreso por Venta",
  Salida: "Salida",
  Transferencia_Banco: "Transferencia a Banco",
  Cierre: "Cierre",
}

function tipoBadgeClass(t: CajaMovimientoTipo): string {
  switch (t) {
    case "Apertura":
    case "Ingreso_Manual":
    case "Ingreso_Venta":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200"
    case "Salida":
    case "Transferencia_Banco":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200"
    case "Cierre":
      return "bg-muted text-muted-foreground border-border"
  }
}

export default function CajaChicaPage() {
  const { toast } = useToast()
  const { ready, razonSocialId } = useTenant()
  const { sesion, saldoActual, loading, featurePending, refetch } =
    useCajaSesion()

  const [movimientos, setMovimientos] = useState<CajaMovimiento[]>([])
  const [loadingMovs, setLoadingMovs] = useState(false)
  const [cuentas, setCuentas] = useState<CuentaConfig[]>([])

  // Tab activo: 'actual' (sesion en curso) o 'historial' (sesiones pasadas)
  const [activeTab, setActiveTab] = useState<"actual" | "historial">("actual")

  // Historial de sesiones cerradas (vista_historico_caja_chica)
  const [historico, setHistorico] = useState<CajaSesionHistorico[]>([])
  const [loadingHistorico, setLoadingHistorico] = useState(false)

  // Detalle del dia: modal que muestra los movimientos de una sesion historica
  const [detalleSesion, setDetalleSesion] =
    useState<CajaSesionHistorico | null>(null)
  const [detalleMovs, setDetalleMovs] = useState<CajaMovimiento[]>([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [detalleConteos, setDetalleConteos] = useState<{ apertura: CajaConteo | null; cierre: CajaConteo | null }>({ apertura: null, cierre: null })

  // Dialog states
  const [openAbrir, setOpenAbrir] = useState(false)
  const [openIngreso, setOpenIngreso] = useState(false)
  const [openSalida, setOpenSalida] = useState(false)
  const [openCierre, setOpenCierre] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form states
  const [ingresoMonto, setIngresoMonto] = useState<string>("")
  const [ingresoConcepto, setIngresoConcepto] = useState<string>("")
  const [salidaMonto, setSalidaMonto] = useState<string>("")
  const [salidaConcepto, setSalidaConcepto] = useState<string>("")
  const [salidaTransferencia, setSalidaTransferencia] = useState(false)
  const [salidaCuentaId, setSalidaCuentaId] = useState<string>("")

  // Conteo fisico de billetes (Lempiras) para apertura y cierre.
  const [conteoApertura, setConteoApertura] = useState<ConteoBilletesType>(conteoVacio())
  const [conteoCierre, setConteoCierre] = useState<ConteoBilletesType>(conteoVacio())

  const reload = useCallback(async () => {
    // 1) Refrescamos la sesion para tener el saldo y estado al dia.
    // 2) Usamos el id devuelto por `refetch()` (fresco) con fallback al
    //    `sesion?.id` del closure si el refetch fallo. Esto blinda el
    //    caso en que un error temporal de `getSesionAbierta` borraria el
    //    historial completo solo porque el refetch volvio null.
    const fresh = await refetch()
    const idActivo = fresh?.id ?? sesion?.id
    console.log("[v0][caja-chica] reload idActivo:", idActivo, {
      fresh: fresh?.id,
      closure: sesion?.id,
    })
    if (idActivo) {
      setLoadingMovs(true)
      const { data, error } = await getMovimientosSesion(idActivo)
      console.log("[v0][caja-chica] reload movimientos:", {
        count: data.length,
        error,
      })
      if (error) {
        toast({
          title: "No se pudo cargar el historial",
          description: error,
          variant: "destructive",
        })
      } else {
        setMovimientos(data)
      }
      setLoadingMovs(false)
    } else {
      setMovimientos([])
    }
  }, [refetch, sesion?.id, toast])

  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) return
    console.log("[v0][caja-chica] initial load useEffect:", {
      sesionId: sesion?.id,
      razonSocialId,
    })
    if (sesion?.id) {
      setLoadingMovs(true)
      getMovimientosSesion(sesion.id).then(({ data, error }) => {
        console.log("[v0][caja-chica] initial load result:", {
          count: data.length,
          error,
        })
        if (error) {
          toast({
            title: "No se pudo cargar el historial",
            description: error,
            variant: "destructive",
          })
        }
        setMovimientos(data)
        setLoadingMovs(false)
      })
    } else {
      setMovimientos([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, razonSocialId, sesion?.id])

  // Carga del historico al entrar al tab. Se vuelve a cargar despues de
  // cualquier cierre para que el historial siempre este al dia.
  const reloadHistorico = useCallback(async () => {
    setLoadingHistorico(true)
    const { data } = await getHistoricoSesiones()
    setHistorico(data)
    setLoadingHistorico(false)
  }, [])

  useEffect(() => {
    if (!ready || razonSocialId == null) return
    if (activeTab === "historial") {
      reloadHistorico()
    }
  }, [ready, razonSocialId, activeTab, reloadHistorico])

  // Click en una fila del historial -> abre modal con los movimientos de
  // esa sesion (ventas, ingresos manuales, salidas, etc.).
  // Pedimos orden ASC para mostrar la cronologia natural Apertura -> Cierre.
  async function openDetalleSesion(sesion: CajaSesionHistorico) {
    setDetalleSesion(sesion)
    setDetalleMovs([])
    setDetalleConteos({ apertura: null, cierre: null })
    setLoadingDetalle(true)
    const [{ data }, conteos] = await Promise.all([
      getMovimientosSesion(sesion.sesion_id, 500, "asc"),
      getConteosSesion(sesion.sesion_id),
    ])
    setDetalleMovs(data)
    setDetalleConteos(conteos)
    setLoadingDetalle(false)
  }

  // Carga de cuentas para el dropdown de Transferencia.
  useEffect(() => {
    if (!ready) return
    if (razonSocialId == null) return
    getCuentas().then(({ data, error }) => {
      if (!error || error !== CAJA_FEATURE_PENDING) {
        setCuentas(data.filter((c) => (c.activo ?? true) && c.tipo === "Banco"))
      }
    })
  }, [ready, razonSocialId])

  // ----- Handlers ---------------------------------------------------------

  async function handleAbrir() {
    const monto = totalConteo(conteoApertura)
    setSubmitting(true)
    const { error } = await abrirSesion(monto, conteoApertura)
    setSubmitting(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Caja abierta", description: `Saldo inicial: ${formatCurrency(monto)}` })
    setOpenAbrir(false)
    setConteoApertura(conteoVacio())
    await reload()
  }

  async function handleIngreso() {
    const monto = Number(ingresoMonto)
    if (Number.isNaN(monto) || monto <= 0) {
      toast({
        title: "Monto invalido",
        description: "Ingrese un monto > 0",
        variant: "destructive",
      })
      return
    }
    setSubmitting(true)
    const { error } = await registrarMovimientoCaja({
      tipo: "Ingreso_Manual",
      monto,
      concepto: ingresoConcepto.trim() || "Ingreso manual",
    })
    setSubmitting(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Ingreso registrado", description: formatCurrency(monto) })
    setOpenIngreso(false)
    setIngresoMonto("")
    setIngresoConcepto("")
    await reload()
  }

  async function handleSalida() {
    const monto = Number(salidaMonto)
    if (Number.isNaN(monto) || monto <= 0) {
      toast({
        title: "Monto invalido",
        description: "Ingrese un monto > 0",
        variant: "destructive",
      })
      return
    }
    if (salidaTransferencia && !salidaCuentaId) {
      toast({
        title: "Cuenta destino",
        description: "Seleccione el banco destino",
        variant: "destructive",
      })
      return
    }
    setSubmitting(true)
    const { error } = await registrarMovimientoCaja({
      tipo: salidaTransferencia ? "Transferencia_Banco" : "Salida",
      monto,
      concepto:
        salidaConcepto.trim() ||
        (salidaTransferencia ? "Transferencia a banco" : "Salida"),
      cuenta_destino_id: salidaTransferencia
        ? Number(salidaCuentaId)
        : null,
    })
    setSubmitting(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    toast({ title: "Salida registrada", description: formatCurrency(monto) })
    setOpenSalida(false)
    setSalidaMonto("")
    setSalidaConcepto("")
    setSalidaTransferencia(false)
    setSalidaCuentaId("")
    await reload()
  }

  async function handleCierre() {
    if (!sesion?.id) return
    const real = totalConteo(conteoCierre)
    setSubmitting(true)
    const { error } = await cerrarSesion({
      sesion_id: sesion.id,
      saldo_final_real: real,
      conteo: conteoCierre,
    })
    setSubmitting(false)
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" })
      return
    }
    const diff = real - saldoActual
    toast({
      title: "Caja cerrada",
      description:
        Math.abs(diff) < 0.005
          ? "Saldo cuadrado correctamente"
          : `Diferencia: ${formatCurrency(diff)}`,
    })
    setOpenCierre(false)
    setConteoCierre(conteoVacio())
    await reload()
    // Si el usuario tiene abierto el tab de historial (poco comun en el
    // mismo flujo, pero posible), refrescamos los totales.
    if (activeTab === "historial") {
      reloadHistorico()
    }
  }

  const saldoExcedido = saldoActual > ALERTA_SALDO
  const cierreCalculado = saldoActual
  const cierreReal = totalConteo(conteoCierre)
  const cierreDiferencia = +(cierreReal - cierreCalculado).toFixed(2)
  const cierreConteoIniciado = Object.values(conteoCierre).some((v) => Number(v) > 0)

  // ----- Render -----------------------------------------------------------

  if (!ready || loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (featurePending) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">Caja Chica</h1>
        <Alert>
          <AlertTitle>Migracion pendiente</AlertTitle>
          <AlertDescription>
            Aplica el script{" "}
            <code className="font-mono text-xs">
              scripts/011-tesoreria-caja-chica.sql
            </code>{" "}
            para activar el modulo de Caja Chica.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Caja Chica
        </h1>
        <p className="text-sm text-muted-foreground">
          Sesion unica de caja menor con saldo running y trazabilidad por movimiento.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "actual" | "historial")}
        className="space-y-4 md:space-y-6"
      >
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-flex">
          <TabsTrigger value="actual" className="gap-2">
            <Wallet className="h-4 w-4" />
            <span>Sesion Actual</span>
          </TabsTrigger>
          <TabsTrigger value="historial" className="gap-2">
            <History className="h-4 w-4" />
            <span>Historial de Sesiones</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actual" className="space-y-4 md:space-y-6 mt-0">
      {/* Estado superior: saldo + acciones */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid md:grid-cols-3">
            {/* Saldo */}
            <div className="md:col-span-1 p-6 bg-muted/30 border-b md:border-b-0 md:border-r">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">
                  Saldo Actual
                </span>
                {saldoExcedido && (
                  <Badge
                    variant="outline"
                    className="ml-auto bg-destructive/10 text-destructive border-destructive/30 gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Alto
                  </Badge>
                )}
              </div>
              <p
                className={`mt-2 text-3xl md:text-4xl font-bold tracking-tight ${
                  saldoExcedido ? "text-destructive" : ""
                }`}
              >
                {sesion ? formatCurrency(saldoActual) : "Sin sesion"}
              </p>
              {sesion ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Apertura: {formatDateTime(sesion.fecha_apertura)}
                  </span>
                  {sesion.usuario_apertura && (
                    <span>Por: {sesion.usuario_apertura}</span>
                  )}
                  <span>
                    Inicial: {formatCurrency(sesion.saldo_inicial)}
                  </span>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No hay sesion activa. Las ventas en efectivo estan bloqueadas.
                </p>
              )}
              {saldoExcedido && (
                <p className="mt-3 text-xs text-destructive">
                  Supera L {ALERTA_SALDO.toLocaleString("en-HN")}. Considere
                  transferir a un banco.
                </p>
              )}
            </div>

            {/* Acciones */}
            <div className="md:col-span-2 p-6 flex flex-col gap-3">
              {!sesion ? (
                <div className="flex-1 flex items-center justify-center">
                  <Button size="lg" onClick={() => { setConteoApertura(conteoVacio()); setOpenAbrir(true) }}>
                    <PlayCircle className="mr-2 h-5 w-5" />
                    Abrir Caja
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setOpenIngreso(true)}
                    className="flex-1 sm:flex-none"
                  >
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    Ingreso Manual
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setOpenSalida(true)}
                    className="flex-1 sm:flex-none"
                  >
                    <ArrowUpFromLine className="mr-2 h-4 w-4" />
                    Salida
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setConteoCierre(conteoVacio()); setOpenCierre(true) }}
                    className="flex-1 sm:flex-none ml-auto"
                  >
                    <StopCircle className="mr-2 h-4 w-4" />
                    Cerrar Caja
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historial */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Movimientos</CardTitle>
          <CardDescription>
            Cronologico (mas reciente arriba) con saldo running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!sesion ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Abra una sesion para ver el historial.
            </p>
          ) : loadingMovs ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : movimientos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sin movimientos aun.
            </p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="block md:hidden space-y-2">
                {movimientos.map((m) => {
                  const positivo = Number(m.monto || 0) >= 0
                  return (
                    <div
                      key={m.id}
                      className="border rounded-lg p-3 bg-card text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <Badge
                            variant="outline"
                            className={`${tipoBadgeClass(m.tipo)} text-[10px]`}
                          >
                            {TIPO_LABEL[m.tipo]}
                          </Badge>
                          <p className="font-medium mt-1 truncate">
                            {m.concepto || "-"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(m.created_at ?? m.fecha)}
                            {m.usuario && ` - ${m.usuario}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`font-mono font-semibold ${
                              positivo ? "text-emerald-600" : "text-amber-700"
                            }`}
                          >
                            {positivo ? "+" : ""}
                            {formatCurrency(m.monto)}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            Saldo: {formatCurrency(m.saldo_resultante)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop table */}
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientos.map((m) => {
                    const positivo = Number(m.monto || 0) >= 0
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDateTime(m.created_at ?? m.fecha)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={tipoBadgeClass(m.tipo)}
                          >
                            {TIPO_LABEL[m.tipo]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {m.concepto || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.usuario || "-"}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${
                            positivo
                              ? "text-emerald-600"
                              : "text-amber-700"
                          }`}
                        >
                          {positivo ? "+" : ""}
                          {formatCurrency(m.monto)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(m.saldo_resultante)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ─── Historial de sesiones ─────────────────────────────── */}
        <TabsContent value="historial" className="space-y-4 mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Sesiones</CardTitle>
              <CardDescription>
                Resumen de cada apertura y cierre de caja. Haga clic en una
                fila para ver el detalle de movimientos del dia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHistorico ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : historico.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay sesiones registradas todavia.
                </p>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="block md:hidden space-y-2">
                    {historico.map((s) => {
                      const dif = Number(s.diferencia ?? 0)
                      const cuadrada = Math.abs(dif) < 0.005
                      return (
                        <button
                          key={s.sesion_id}
                          type="button"
                          onClick={() => openDetalleSesion(s)}
                          className="w-full text-left border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">
                                {formatDate(s.fecha_apertura)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {s.usuario_apertura ?? "-"}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                s.estado === "Abierta"
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : "bg-muted text-muted-foreground"
                              }
                            >
                              {s.estado}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                            <div>
                              <p className="text-muted-foreground">Inicial</p>
                              <p className="font-mono font-semibold">
                                {formatCurrency(s.saldo_inicial)}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Final</p>
                              <p className="font-mono font-semibold">
                                {formatCurrency(
                                  s.saldo_final_real ?? s.saldo_final_calculado
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-emerald-700">Ingresos (+)</p>
                              <p className="font-mono">
                                {formatCurrency(s.total_ingresos)}
                              </p>
                            </div>
                            <div>
                              <p className="text-amber-700">Egresos (-)</p>
                              <p className="font-mono">
                                {formatCurrency(s.total_egresos)}
                              </p>
                            </div>
                          </div>
                          {s.estado === "Cerrada" && (
                            <div
                              className={`mt-2 text-xs rounded px-2 py-1 ${
                                cuadrada
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-amber-50 text-amber-800"
                              }`}
                            >
                              Diferencia:{" "}
                              <span className="font-mono font-semibold">
                                {dif >= 0 ? "+" : ""}
                                {formatCurrency(dif)}
                              </span>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Usuario</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">
                            Saldo Inicial
                          </TableHead>
                          <TableHead className="text-right text-emerald-700">
                            Ingresos (+)
                          </TableHead>
                          <TableHead className="text-right text-amber-700">
                            Egresos (-)
                          </TableHead>
                          <TableHead className="text-right">
                            Saldo Final
                          </TableHead>
                          <TableHead className="text-right">
                            Diferencia
                          </TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historico.map((s) => {
                          const dif = Number(s.diferencia ?? 0)
                          const cuadrada =
                            s.estado !== "Cerrada" || Math.abs(dif) < 0.005
                          return (
                            <TableRow
                              key={s.sesion_id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => openDetalleSesion(s)}
                            >
                              <TableCell className="whitespace-nowrap">
                                {formatDate(s.fecha_apertura)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {s.usuario_apertura ?? "-"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    s.estado === "Abierta"
                                      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                      : "bg-muted text-muted-foreground"
                                  }
                                >
                                  {s.estado}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(s.saldo_inicial)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-emerald-600">
                                {formatCurrency(s.total_ingresos)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-amber-700">
                                {formatCurrency(s.total_egresos)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {formatCurrency(
                                  s.saldo_final_real ??
                                    s.saldo_final_calculado
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono ${
                                  cuadrada
                                    ? "text-muted-foreground"
                                    : "text-amber-700 font-semibold"
                                }`}
                              >
                                {s.estado === "Cerrada"
                                  ? `${dif >= 0 ? "+" : ""}${formatCurrency(dif)}`
                                  : "-"}
                              </TableCell>
                              <TableCell>
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Dialog: Detalle del Dia ─────���───────────────────────── */}
      <Dialog
        open={detalleSesion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetalleSesion(null)
            setDetalleMovs([])
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Detalle del Dia
              {detalleSesion &&
                ` - ${formatDate(detalleSesion.fecha_apertura)}`}
            </DialogTitle>
            <DialogDescription>
              {detalleSesion
                ? `Sesion #${detalleSesion.sesion_id} - ${detalleSesion.usuario_apertura ?? "-"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {detalleSesion && (
            <>
              {/* Resumen rapido */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    Saldo Inicial
                  </p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(detalleSesion.saldo_inicial)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-emerald-700">Ingresos (+)</p>
                  <p className="font-mono font-semibold text-emerald-700">
                    {formatCurrency(detalleSesion.total_ingresos)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-amber-700">Egresos (-)</p>
                  <p className="font-mono font-semibold text-amber-700">
                    {formatCurrency(detalleSesion.total_egresos)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Saldo Final</p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(
                      detalleSesion.saldo_final_real ??
                        detalleSesion.saldo_final_calculado
                    )}
                  </p>
                </div>
              </div>

              {/* Conteo de billetes (apertura/cierre) */}
              {(detalleConteos.apertura || detalleConteos.cierre) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(["apertura", "cierre"] as const).map((tipo) => {
                    const conteo = detalleConteos[tipo]
                    if (!conteo) return null
                    return (
                      <div key={tipo} className="rounded-lg border p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2 capitalize">
                          Conteo de {tipo}
                        </p>
                        <div className="space-y-0.5">
                          {DENOMINACIONES_LEMPIRA.filter(
                            (d) => Number(conteo.detalle[String(d)]) > 0
                          ).map((d) => (
                            <div key={d} className="flex justify-between text-xs">
                              <span className="text-muted-foreground">
                                L {d} × {conteo.detalle[String(d)]}
                              </span>
                              <span className="tabular-nums">
                                L {(d * Number(conteo.detalle[String(d)])).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-sm font-semibold border-t mt-2 pt-1">
                          <span>Total</span>
                          <span className="font-mono">{formatCurrency(conteo.total)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Tabla de movimientos */}
              {loadingDetalle ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : detalleMovs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Esta sesion no tuvo movimientos.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Concepto</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalleMovs.map((m) => {
                        const positivo = Number(m.monto || 0) >= 0
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {formatDateTime(m.created_at ?? m.fecha)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={tipoBadgeClass(m.tipo)}
                              >
                                {TIPO_LABEL[m.tipo]}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {m.concepto || "-"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {m.usuario || "-"}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                positivo
                                  ? "text-emerald-600"
                                  : "text-amber-700"
                              }`}
                            >
                              {positivo ? "+" : ""}
                              {formatCurrency(m.monto)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatCurrency(m.saldo_resultante)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Abrir caja */}
      <Dialog open={openAbrir} onOpenChange={setOpenAbrir}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir Caja</DialogTitle>
            <DialogDescription>
              Cuenta los billetes con los que inicia el dia. El saldo inicial se calcula automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <ConteoBilletesInput value={conteoApertura} onChange={setConteoApertura} />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpenAbrir(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleAbrir} disabled={submitting}>
              {submitting && <Spinner className="mr-2" />}Abrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Ingreso manual */}
      <Dialog open={openIngreso} onOpenChange={setOpenIngreso}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ingreso Manual</DialogTitle>
            <DialogDescription>
              Inyectar efectivo a la caja (no asociado a una venta).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ing-monto">Monto (L)</Label>
              <Input
                id="ing-monto"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={ingresoMonto}
                onChange={(e) => setIngresoMonto(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ing-concepto">Concepto</Label>
              <Input
                id="ing-concepto"
                placeholder="Reposicion, prestamo, etc."
                value={ingresoConcepto}
                onChange={(e) => setIngresoConcepto(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpenIngreso(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleIngreso} disabled={submitting}>
              {submitting && <Spinner className="mr-2" />}Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Salida */}
      <Dialog open={openSalida} onOpenChange={setOpenSalida}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salida de Caja</DialogTitle>
            <DialogDescription>
              Retira efectivo. Marca &quot;Transferencia a Banco&quot; para mover el
              dinero a una cuenta configurada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sal-monto">Monto (L)</Label>
                <Input
                  id="sal-monto"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.01}
                  value={salidaMonto}
                  onChange={(e) => setSalidaMonto(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sal-concepto">Concepto</Label>
                <Input
                  id="sal-concepto"
                  placeholder="Pago a proveedor, gasto..."
                  value={salidaConcepto}
                  onChange={(e) => setSalidaConcepto(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="sal-transferencia" className="text-sm">
                    Transferencia a Banco
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Espeja un Ingreso en la cuenta destino.
                  </p>
                </div>
              </div>
              <Switch
                id="sal-transferencia"
                checked={salidaTransferencia}
                onCheckedChange={setSalidaTransferencia}
              />
            </div>

            {salidaTransferencia && (
              <div className="grid gap-2">
                <Label htmlFor="sal-cuenta">Cuenta destino</Label>
                <Select
                  value={salidaCuentaId}
                  onValueChange={setSalidaCuentaId}
                >
                  <SelectTrigger id="sal-cuenta">
                    <SelectValue placeholder="Seleccione cuenta..." />
                  </SelectTrigger>
                  <SelectContent>
                    {cuentas.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No hay cuentas activas. Configurelas primero.
                      </SelectItem>
                    ) : (
                      cuentas.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nombre}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpenSalida(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleSalida} disabled={submitting}>
              {submitting && <Spinner className="mr-2" />}Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Cierre */}
      <Dialog open={openCierre} onOpenChange={setOpenCierre}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar Caja</DialogTitle>
            <DialogDescription>
              Compara el efectivo fisico contra el saldo calculado del sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Efectivo segun sistema:
                </span>
                <span className="font-mono font-semibold">
                  {formatCurrency(cierreCalculado)}
                </span>
              </div>
            </div>

            <ConteoBilletesInput value={conteoCierre} onChange={setConteoCierre} />

            {cierreConteoIniciado && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  Math.abs(cierreDiferencia) < 0.005
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200"
                    : "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/20 dark:text-red-200"
                }`}
              >
                <div className="flex justify-between">
                  <span>Diferencia (contado vs sistema):</span>
                  <span className="font-mono font-semibold">
                    {cierreDiferencia >= 0 ? "+" : ""}
                    {formatCurrency(cierreDiferencia)}
                  </span>
                </div>
                {Math.abs(cierreDiferencia) >= 0.005 && (
                  <p className="mt-1 text-xs">
                    Se registrara esta diferencia al cerrar. Puedes recontar antes de continuar.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setOpenCierre(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              variant="outline"
              onClick={() => setConteoCierre(conteoVacio())}
              disabled={submitting}
            >
              Recontar
            </Button>
            <Button
              onClick={handleCierre}
              disabled={submitting || !cierreConteoIniciado}
            >
              {submitting && <Spinner className="mr-2" />}
              {Math.abs(cierreDiferencia) >= 0.005 ? "Aprobar y cerrar caja" : "Cerrar Caja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
