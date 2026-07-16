"use client"

import * as React from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Store,
  CreditCard,
  TrendingUp,
  Clock,
  Users,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import {
  getDashboardMetrics,
  getVentasVsCobros,
  type DashboardMetrics,
  type VentasVsCobros,
} from "@/lib/services/dashboard"
import {
  getPagosAlquilerDelMes,
  type PagoAlquiler,
} from "@/lib/services/pagos-alquiler"
import { getEmprendimientos } from "@/lib/services/emprendimientos"
import { useTenant } from "@/lib/hooks/use-tenant"
import { useToast } from "@/hooks/use-toast"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

function formatCurrency(value: number): string {
  return `L ${value.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00")
  return date.toLocaleDateString("es-HN", { weekday: "short", day: "numeric" })
}

export default function DashboardPage() {
  const { razonSocialId, ready } = useTenant()
  const { toast } = useToast()

  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null)
  const [ventasVsCobros, setVentasVsCobros] = React.useState<VentasVsCobros[]>([])
  const [empCount, setEmpCount] = React.useState(0)
  const [pagosDelMes, setPagosDelMes] = React.useState<PagoAlquiler[]>([])
  const [loading, setLoading] = React.useState(true)

  const now = new Date()
  const mesActual = now.getMonth() + 1
  const anioActual = now.getFullYear()

  const loadData = React.useCallback(async () => {
    if (!ready) return
    if (razonSocialId == null) {
      setMetrics({ valorInventario: 0, cuentasPorCobrar: 0, utilidadBruta: 0, ventasMes: 0, ventasMesCount: 0 })
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [metricsRes, ventasRes, emps, pagosRes] = await Promise.all([
        getDashboardMetrics(razonSocialId),
        getVentasVsCobros(razonSocialId, 7),
        getEmprendimientos(razonSocialId),
        getPagosAlquilerDelMes(razonSocialId, anioActual, mesActual),
      ])

      setMetrics(metricsRes.data)
      setVentasVsCobros(ventasRes.data)
      setEmpCount((emps ?? []).filter((e: any) => e.activo !== false).length)
      setPagosDelMes(pagosRes)

      const firstError = metricsRes.error || ventasRes.error
      if (firstError) {
        console.log("[Dashboard] advertencia de carga parcial:", firstError)
      }
    } catch (error: any) {
      toast({
        title: "No se pudieron cargar los datos",
        description: error?.message || "Error de conexión",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [ready, razonSocialId, anioActual, mesActual, toast])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const chartData = ventasVsCobros.map(item => ({
    name: formatShortDate(item.fecha),
    Ventas: Math.round(item.ventas * 100) / 100,
    Cobros: Math.round(item.cobros * 100) / 100,
  }))

  const totalAlquilerPagado = pagosDelMes
    .filter(p => p.estado === "pagado")
    .reduce((s, p) => s + p.monto, 0)
  const pagosPendientes = pagosDelMes.filter(p => p.estado === "pendiente")
  const MESES_NOMBRES = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
  ]

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-stone-800">Dashboard</h1>
          <p className="text-xs md:text-sm text-stone-500 leading-relaxed">
            Vista general de la operación de la concept store
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="rounded-xl border-stone-200 hover:bg-stone-100 hover:border-stone-300 transition-all duration-300 w-full sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 md:gap-5 grid-cols-2 lg:grid-cols-4">
        {/* Emprendedores Activos */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 border-l-4 border-l-[#5D7B6F] bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-stone-600">
              Emprendedores
            </CardTitle>
            <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl bg-[#5D7B6F]/10 flex items-center justify-center">
              <Store className="h-4 w-4 md:h-5 md:w-5 text-[#5D7B6F]" />
            </div>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {loading ? (
              <Skeleton className="h-6 md:h-8 w-16" />
            ) : (
              <div className="text-lg md:text-2xl font-bold text-stone-800">{empCount}</div>
            )}
            <p className="text-[10px] md:text-xs text-stone-500 mt-1 hidden sm:block">Activos en la tienda</p>
          </CardContent>
        </Card>

        {/* Alquiler Recaudado */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 border-l-4 border-l-[#7C9A92] bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-stone-600">
              Alquiler Recaudado
            </CardTitle>
            <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl bg-[#7C9A92]/10 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-[#7C9A92]" />
            </div>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {loading ? (
              <Skeleton className="h-6 md:h-8 w-24 md:w-32" />
            ) : (
              <div className="text-lg md:text-2xl font-bold text-stone-800">
                {formatCurrency(totalAlquilerPagado)}
              </div>
            )}
            <p className="text-[10px] md:text-xs text-stone-500 mt-1 hidden sm:block">
              {MESES_NOMBRES[mesActual - 1]} {anioActual}
            </p>
          </CardContent>
        </Card>

        {/* Pendientes de Alquiler */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 border-l-4 border-l-[#D4A574] bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-stone-600">
              Pendientes Alquiler
            </CardTitle>
            <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl bg-[#D4A574]/10 flex items-center justify-center">
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-[#D4A574]" />
            </div>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {loading ? (
              <Skeleton className="h-6 md:h-8 w-16" />
            ) : (
              <div className="text-lg md:text-2xl font-bold text-stone-800">{pagosPendientes.length}</div>
            )}
            <p className="text-[10px] md:text-xs text-stone-500 mt-1 hidden sm:block">Sin pagar este mes</p>
          </CardContent>
        </Card>

        {/* Por Cobrar en Ventas */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 border-l-4 border-l-[#C07A5C] bg-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-stone-600">
              Por Cobrar Ventas
            </CardTitle>
            <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl bg-[#C07A5C]/10 flex items-center justify-center">
              <CreditCard className="h-4 w-4 md:h-5 md:w-5 text-[#C07A5C]" />
            </div>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {loading ? (
              <Skeleton className="h-6 md:h-8 w-24 md:w-32" />
            ) : (
              <div className="text-lg md:text-2xl font-bold text-stone-800">
                {formatCurrency(metrics?.cuentasPorCobrar || 0)}
              </div>
            )}
            <p className="text-[10px] md:text-xs text-stone-500 mt-1 hidden sm:block">Cartera pendiente</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        {/* Ventas vs Cobros Chart */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 bg-white">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-base md:text-lg font-semibold text-stone-800">Ventas vs Cobros</CardTitle>
            <CardDescription className="text-xs md:text-sm text-stone-500">Últimos 7 días</CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            {loading ? (
              <div className="h-[250px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `L${v}`} />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), ""]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Ventas" fill="#5D7B6F" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Cobros" fill="#7C9A92" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                No hay datos para mostrar
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resultado Financiero */}
        <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 bg-white">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-base md:text-lg font-semibold text-stone-800">Resultado del Período</CardTitle>
            <CardDescription className="text-xs md:text-sm text-stone-500">Indicadores financieros</CardDescription>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-700">Utilidad Bruta</p>
                      <p className="text-xs text-stone-500">Acumulada</p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-emerald-700">{formatCurrency(metrics?.utilidadBruta || 0)}</p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-blue-50 border border-blue-100">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-blue-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-700">Alquiler Recaudado</p>
                      <p className="text-xs text-stone-500">{MESES_NOMBRES[mesActual - 1]} — {pagosDelMes.filter(p => p.estado === "pagado").length} pagados</p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-blue-700">{formatCurrency(totalAlquilerPagado)}</p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 border border-amber-100">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Users className="h-4 w-4 text-amber-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-700">Emprendedores activos</p>
                      <p className="text-xs text-stone-500">Registrados en el sistema</p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-amber-700">{empCount}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pendientes de Alquiler */}
      <Card className="card-elevated rounded-xl md:rounded-2xl border-stone-200/60 bg-white">
        <CardHeader className="p-4 md:p-6 pb-2 md:pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 md:h-8 md:w-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-700" />
              </div>
              <CardTitle className="text-base md:text-lg font-semibold text-stone-800">
                Alquiler Pendiente — {MESES_NOMBRES[mesActual - 1]} {anioActual}
              </CardTitle>
            </div>
            <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100 text-xs">
              {pagosPendientes.length}
            </Badge>
          </div>
          <CardDescription className="text-xs md:text-sm text-stone-500 mt-1">
            Emprendedores con pago de alquiler pendiente este mes
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : pagosPendientes.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">
                {pagosDelMes.length === 0
                  ? "No hay registros generados para este mes. Ve a Pagos de Alquiler → Generar mes."
                  : "¡Todos los emprendedores han pagado su alquiler este mes!"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pagosPendientes.map(p => (
                <div
                  key={p.id ?? p.emprendimiento_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-orange-50/60 border border-orange-100"
                >
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-orange-500" />
                    <span className="text-sm font-medium text-stone-700">{p.emprendimiento_nombre}</span>
                  </div>
                  <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                    L {(p.valor_alquiler_esperado ?? 0).toFixed(2)} pendiente
                  </Badge>
                </div>
              ))}
              <Link href="/concept-store/pagos-alquiler">
                <Button variant="ghost" size="sm" className="w-full mt-2 text-stone-600 hover:text-stone-800">
                  Gestionar pagos <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
