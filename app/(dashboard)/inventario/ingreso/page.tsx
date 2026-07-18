"use client"

import * as React from "react"
import {
  Package, Warehouse, MapPin, AlertTriangle, Search,
  ArrowDownCircle, ArrowUpCircle, FileSpreadsheet, Upload, X, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import {
  getProductoPorId,
  buscarProductos,
  getAlmacenes, getLocalizaciones,
  type Producto, type Almacen, type Localizacion,
} from "@/lib/services/catalogos"
import { procesarIngresoManual, procesarSalidaManual, procesarIngresosMasivoAdmin } from "@/lib/services/inventario"
import { parseInventarioExcelRaw } from "@/lib/utils/excel-parsers"

type TipoMovimiento = "ingreso" | "salida"

interface FilaExcel {
  codigo_barras: string
  cantidad: number
  costo_unitario: number | null
  _error?: string
}

export default function MovimientosManualesPage() {
  const { toast } = useToast()
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  const [localizaciones, setLocalizaciones] = React.useState<Localizacion[]>([])
  const [localizacionesFiltradas, setLocalizacionesFiltradas] = React.useState<Localizacion[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  // ── Búsqueda por código o nombre ─────────────────────────────
  const [codigoBusqueda, setCodigoBusqueda] = React.useState("")
  const [buscandoProducto, setBuscandoProducto] = React.useState(false)
  const [productoEncontrado, setProductoEncontrado] = React.useState<Producto | null>(null)
  const [errorBusqueda, setErrorBusqueda] = React.useState<string | null>(null)
  const [resultadosBusqueda, setResultadosBusqueda] = React.useState<Producto[]>([])

  // ── Individual ──────────────────────────────────────────────
  const [tipoInd, setTipoInd] = React.useState<TipoMovimiento>("ingreso")
  const [formData, setFormData] = React.useState({
    almacen_id: "", localizacion_id: "",
    cantidad: "", costo_unitario: "", observaciones: "",
  })

  // ── Masivo Excel ────────────────────────────────────────────
  const [tipoMasivo, setTipoMasivo] = React.useState<TipoMovimiento>("ingreso")
  const [almacenMasivo, setAlmacenMasivo] = React.useState("")
  const [localizacionMasivo, setLocalizacionMasivo] = React.useState("")
  const [localizacionesMasivo, setLocalizacionesMasivo] = React.useState<Localizacion[]>([])
  const [filasExcel, setFilasExcel] = React.useState<FilaExcel[]>([])
  const [erroresExcel, setErroresExcel] = React.useState<string[]>([])
  const [procesando, setProcesando] = React.useState(false)
  const [resultadoMasivo, setResultadoMasivo] = React.useState<{ procesados: number; errores: string[] } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [almRes, locRes] = await Promise.all([getAlmacenes(), getLocalizaciones()])
    if (almRes.error) toast({ title: "Error", description: almRes.error, variant: "destructive" })
    setAlmacenes(almRes.data)
    setLocalizaciones(locRes.data)
    if (almRes.data.length === 1) {
      const almId = almRes.data[0].id!.toString()
      setFormData(prev => ({ ...prev, almacen_id: almId }))
      setAlmacenMasivo(almId)
      const filtradas = locRes.data.filter(l => l.almacen_id === almRes.data[0].id)
      setLocalizacionesFiltradas(filtradas)
      setLocalizacionesMasivo(filtradas)
      if (filtradas.length === 1) {
        setFormData(prev => ({ ...prev, almacen_id: almId, localizacion_id: filtradas[0].id!.toString() }))
        setLocalizacionMasivo(filtradas[0].id!.toString())
      }
    }
    setLoading(false)
  }

  async function buscarProducto() {
    const texto = codigoBusqueda.trim()
    if (!texto) return
    setBuscandoProducto(true)
    setProductoEncontrado(null)
    setErrorBusqueda(null)
    setResultadosBusqueda([])

    const { data, error } = await buscarProductos(texto, { limit: 8 })
    setBuscandoProducto(false)

    if (error) {
      setErrorBusqueda(error)
      return
    }
    if (data.length === 0) {
      setErrorBusqueda("Producto no encontrado")
      return
    }
    if (data.length === 1) {
      await seleccionarProducto(data[0])
      return
    }
    // Varias coincidencias (busqueda por nombre) — el usuario elige.
    setResultadosBusqueda(data)
  }

  // Al elegir un producto (de la lista de resultados o cuando la busqueda
  // resuelve a uno solo), recargamos por ID para traer el stock real desde
  // vista_stock_por_localizacion (buscarProductos no lo trae autoritativo).
  async function seleccionarProducto(producto: Producto) {
    setResultadosBusqueda([])
    setBuscandoProducto(true)
    const { data, error } = await getProductoPorId(producto.id!)
    setBuscandoProducto(false)
    if (error || !data) {
      setErrorBusqueda(error ?? "Producto no encontrado")
      return
    }
    setProductoEncontrado(data)
    setCodigoBusqueda(data.codigo_barras || data.nombre)
  }

  function handleCodigoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      buscarProducto()
    }
  }

  function handleAlmacenChange(value: string) {
    setFormData(prev => ({ ...prev, almacen_id: value, localizacion_id: "" }))
    const filtradas = localizaciones.filter(l => l.almacen_id === parseInt(value))
    setLocalizacionesFiltradas(filtradas)
    if (filtradas.length === 1) {
      setFormData(prev => ({ ...prev, almacen_id: value, localizacion_id: filtradas[0].id!.toString() }))
    }
  }

  function handleAlmacenMasivoChange(value: string) {
    setAlmacenMasivo(value)
    setLocalizacionMasivo("")
    const filtradas = localizaciones.filter(l => l.almacen_id === parseInt(value))
    setLocalizacionesMasivo(filtradas)
    if (filtradas.length === 1) setLocalizacionMasivo(filtradas[0].id!.toString())
  }

  const cantidadNum = parseFloat(formData.cantidad) || 0
  const costoNum = parseFloat(formData.costo_unitario) || 0
  const stockActual = productoEncontrado?.stock_total ?? 0
  const costoActual = productoEncontrado?.costo_promedio ?? 0
  const nuevoStock = tipoInd === "ingreso"
    ? stockActual + cantidadNum
    : Math.max(0, stockActual - cantidadNum)
  const nuevoCosto = tipoInd === "ingreso" && nuevoStock > 0
    ? ((stockActual * costoActual) + (cantidadNum * costoNum)) / nuevoStock
    : costoActual

  // ── Ingreso/Salida individual ────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productoEncontrado?.id) {
      toast({ title: "Error", description: "Busque y seleccione un producto primero", variant: "destructive" })
      return
    }
    if (!formData.almacen_id) {
      toast({ title: "Error", description: "Seleccione un almacén", variant: "destructive" })
      return
    }
    if (!formData.localizacion_id) {
      toast({ title: "Error", description: "Seleccione una localización", variant: "destructive" })
      return
    }
    if (cantidadNum <= 0) {
      toast({ title: "Error", description: "Ingrese una cantidad válida", variant: "destructive" })
      return
    }
    if (tipoInd === "ingreso" && costoNum <= 0) {
      toast({ title: "Error", description: "Ingrese un costo unitario válido", variant: "destructive" })
      return
    }

    setSaving(true)

    let result: { success: boolean; error: string | null }
    if (tipoInd === "ingreso") {
      result = await procesarIngresoManual({
        producto_id: productoEncontrado.id,
        almacen_id: parseInt(formData.almacen_id),
        localizacion_id: parseInt(formData.localizacion_id),
        cantidad: cantidadNum,
        costo_unitario: costoNum,
        observaciones: formData.observaciones,
        stock_anterior: stockActual,
        costo_anterior: costoActual,
        nuevo_stock: nuevoStock,
        nuevo_costo: nuevoCosto,
      })
    } else {
      result = await procesarSalidaManual({
        producto_id: productoEncontrado.id,
        almacen_id: parseInt(formData.almacen_id),
        localizacion_id: parseInt(formData.localizacion_id),
        cantidad: cantidadNum,
        observaciones: formData.observaciones,
      })
    }

    setSaving(false)
    if (result.error) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: tipoInd === "ingreso" ? "Ingreso procesado" : "Salida procesada",
      description: `${cantidadNum} unidades de ${productoEncontrado.nombre}`,
    })

    // Reset producto y campos de cantidad
    setCodigoBusqueda("")
    setProductoEncontrado(null)
    setErrorBusqueda(null)
    setResultadosBusqueda([])
    setFormData(prev => ({
      ...prev,
      cantidad: "",
      costo_unitario: "",
      observaciones: "",
    }))
  }

  // ── Excel masivo ─────────────────────────────────────────────
  async function handleExcelFile(file: File) {
    const buffer = await file.arrayBuffer()
    const { rows, errors } = parseInventarioExcelRaw(Buffer.from(buffer))
    setFilasExcel(rows as FilaExcel[])
    setErroresExcel(errors)
    setResultadoMasivo(null)
  }

  async function procesarMasivo() {
    if (!almacenMasivo) { toast({ title: "Error", description: "Seleccione un almacén", variant: "destructive" }); return }
    if (!localizacionMasivo) { toast({ title: "Error", description: "Seleccione una localización", variant: "destructive" }); return }
    if (filasExcel.length === 0) { toast({ title: "Error", description: "Cargue un archivo primero", variant: "destructive" }); return }
    setProcesando(true)
    const resultado = await procesarIngresosMasivoAdmin(
      filasExcel.map(f => ({ codigo_barras: f.codigo_barras, cantidad: f.cantidad, costo_unitario: f.costo_unitario })),
      tipoMasivo,
      parseInt(almacenMasivo),
      parseInt(localizacionMasivo)
    )
    setProcesando(false)
    setResultadoMasivo(resultado)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Movimientos Manuales</h1>
        <p className="text-sm md:text-base text-muted-foreground">Registrar entradas y salidas de inventario</p>
      </div>

      <Tabs defaultValue="individual" className="space-y-4">
        <TabsList>
          <TabsTrigger value="individual">Individual</TabsTrigger>
          <TabsTrigger value="masivo">Masivo (Excel)</TabsTrigger>
        </TabsList>

        {/* ──────────────────────── TAB INDIVIDUAL ──────────────────────── */}
        <TabsContent value="individual" className="space-y-4">
          {/* Tipo toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={tipoInd === "ingreso" ? "default" : "outline"}
              onClick={() => setTipoInd("ingreso")}
              className={tipoInd === "ingreso" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              <ArrowDownCircle className="h-4 w-4 mr-2" />
              Ingreso
            </Button>
            <Button
              type="button"
              variant={tipoInd === "salida" ? "default" : "outline"}
              onClick={() => setTipoInd("salida")}
              className={tipoInd === "salida" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              <ArrowUpCircle className="h-4 w-4 mr-2" />
              Salida
            </Button>
          </div>

          <Alert className={tipoInd === "ingreso" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}>
            <AlertTriangle className={`h-4 w-4 ${tipoInd === "ingreso" ? "text-amber-600" : "text-red-600"}`} />
            <AlertTitle className={tipoInd === "ingreso" ? "text-amber-800" : "text-red-800"}>
              {tipoInd === "ingreso" ? "Ingreso de inventario" : "Salida de inventario"}
            </AlertTitle>
            <AlertDescription className={tipoInd === "ingreso" ? "text-amber-700" : "text-red-700"}>
              {tipoInd === "ingreso"
                ? "Esta acción afectará el costo promedio del producto y aumentará el stock."
                : "Esta acción reducirá el stock del producto. El costo promedio no cambia en salidas."}
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
              {/* Búsqueda y datos del producto */}
              <Card className="lg:col-span-2 border-amber-100 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
                <CardHeader className="p-4 md:p-6">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <Package className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
                    Buscar Producto
                  </CardTitle>
                  <CardDescription>Escriba el código de barras o el nombre del producto y presione la lupa o Enter</CardDescription>
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0 space-y-4">
                  {/* Buscador por código o nombre */}
                  <div className="space-y-2">
                    <Label className="text-sm">Producto (código o nombre)</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Escribe el código o el nombre y presiona Enter o la lupa..."
                        value={codigoBusqueda}
                        onChange={(e) => {
                          setCodigoBusqueda(e.target.value)
                          if (productoEncontrado) {
                            setProductoEncontrado(null)
                          }
                          setErrorBusqueda(null)
                          setResultadosBusqueda([])
                        }}
                        onKeyDown={handleCodigoKeyDown}
                        className="bg-background font-mono"
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={buscarProducto}
                        disabled={buscandoProducto || !codigoBusqueda.trim()}
                        title="Buscar producto"
                      >
                        {buscandoProducto
                          ? <Spinner className="h-4 w-4" />
                          : <Search className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Varias coincidencias (busqueda por nombre) */}
                  {resultadosBusqueda.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-background divide-y max-h-56 overflow-y-auto">
                      {resultadosBusqueda.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => seleccionarProducto(p)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-amber-50 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{p.nombre}</p>
                            <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras || "sin código"}</p>
                          </div>
                          <span className="text-xs text-primary shrink-0">Seleccionar</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Error de búsqueda */}
                  {errorBusqueda && (
                    <Alert className="border-red-200 bg-red-50 py-3">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700 text-sm">
                        {errorBusqueda} — verifique el código o nombre e intente nuevamente.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Datos del producto encontrado */}
                  {productoEncontrado && (
                    <div className="p-3 md:p-4 bg-background border border-green-200 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Producto encontrado</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-stone-400 hover:text-stone-600"
                          onClick={() => {
                            setProductoEncontrado(null)
                            setCodigoBusqueda("")
                            setErrorBusqueda(null)
                            setResultadosBusqueda([])
                          }}
                          title="Limpiar selección"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                        <div className="md:col-span-2">
                          <p className="text-xs text-muted-foreground">Nombre</p>
                          <p className="font-semibold text-sm">{productoEncontrado.nombre}</p>
                          {productoEncontrado.emprendimiento_nombre && (
                            <p className="text-xs text-amber-600 mt-0.5">{productoEncontrado.emprendimiento_nombre}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Código</p>
                          <p className="font-mono text-sm">{productoEncontrado.codigo_barras || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Costo Promedio</p>
                          <p className="font-medium text-sm text-primary">L {costoActual.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t flex items-center gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Stock en inventario</p>
                          <p className={`font-bold text-2xl ${stockActual === 0 ? "text-red-600" : "text-stone-800"}`}>
                            {stockActual}
                          </p>
                        </div>
                        {stockActual === 0 && tipoInd === "salida" && (
                          <Badge variant="destructive" className="text-xs">Sin stock disponible</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Cantidad + costo */}
                  <div className={`grid gap-4 ${tipoInd === "ingreso" ? "md:grid-cols-2" : ""}`}>
                    <div className="space-y-2">
                      <Label className="text-sm">Cantidad</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="0"
                        value={formData.cantidad}
                        onChange={(e) => setFormData(prev => ({ ...prev, cantidad: e.target.value }))}
                        className="bg-background"
                        disabled={!productoEncontrado}
                      />
                    </div>
                    {tipoInd === "ingreso" && (
                      <div className="space-y-2">
                        <Label className="text-sm">Costo Unitario (L)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={formData.costo_unitario}
                          onChange={(e) => setFormData(prev => ({ ...prev, costo_unitario: e.target.value }))}
                          className="bg-background"
                          disabled={!productoEncontrado}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Observaciones (opcional)</Label>
                    <Textarea
                      placeholder="Notas adicionales..."
                      value={formData.observaciones}
                      onChange={(e) => setFormData(prev => ({ ...prev, observaciones: e.target.value }))}
                      rows={2}
                      className="bg-background"
                      disabled={!productoEncontrado}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Ubicación + Preview */}
              <div className="space-y-4">
                <Card className="border-amber-100 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
                  <CardHeader className="p-4 md:p-6">
                    <CardTitle className="text-base md:text-lg flex items-center gap-2">
                      <Warehouse className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
                      Ubicación
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 md:p-6 pt-0 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Almacén</Label>
                      <Select value={formData.almacen_id} onValueChange={handleAlmacenChange}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Seleccione almacén" />
                        </SelectTrigger>
                        <SelectContent>
                          {almacenes.map((a) => (
                            <SelectItem key={a.id} value={a.id!.toString()}>{a.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" /> Localización
                      </Label>
                      <Select
                        value={formData.localizacion_id}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, localizacion_id: v }))}
                        disabled={!formData.almacen_id}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder={formData.almacen_id ? "Seleccione localización" : "Primero seleccione almacén"} />
                        </SelectTrigger>
                        <SelectContent>
                          {localizacionesFiltradas.map((l) => (
                            <SelectItem key={l.id} value={l.id!.toString()}>{l.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Preview del impacto */}
                {productoEncontrado && cantidadNum > 0 && (
                  <Card className={`border-2 ${tipoInd === "ingreso" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                    <CardContent className="p-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Impacto del {tipoInd === "ingreso" ? "ingreso" : "salida"}
                      </p>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Stock actual</span>
                        <span className="font-mono font-medium">{stockActual}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">{tipoInd === "ingreso" ? "+ Ingreso" : "− Salida"}</span>
                        <span className={`font-mono font-medium ${tipoInd === "ingreso" ? "text-green-600" : "text-red-600"}`}>
                          {tipoInd === "ingreso" ? "+" : "−"}{cantidadNum}
                        </span>
                      </div>
                      <div className="border-t pt-2 flex justify-between items-center">
                        <span className="text-sm font-semibold">Nuevo stock</span>
                        <span className="font-mono font-bold text-lg">{nuevoStock}</span>
                      </div>
                      {tipoInd === "ingreso" && costoNum > 0 && (
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span>Nuevo costo prom.</span>
                          <span className="font-mono">L {nuevoCosto.toFixed(2)}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Button
                  type="submit"
                  className={`w-full ${tipoInd === "ingreso" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                  disabled={saving || !productoEncontrado}
                >
                  {saving ? (
                    <><Spinner className="h-4 w-4 mr-2" /> Procesando...</>
                  ) : tipoInd === "ingreso" ? (
                    <><ArrowDownCircle className="h-4 w-4 mr-2" /> Registrar Ingreso</>
                  ) : (
                    <><ArrowUpCircle className="h-4 w-4 mr-2" /> Registrar Salida</>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </TabsContent>

        {/* ──────────────────────── TAB MASIVO ──────────────────────── */}
        <TabsContent value="masivo" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Controles */}
            <Card className="md:col-span-1 border-amber-100 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-amber-600" />
                  Configuración
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0 space-y-4">
                {/* Tipo */}
                <div className="space-y-2">
                  <Label className="text-sm">Tipo de movimiento</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={tipoMasivo === "ingreso" ? "default" : "outline"}
                      onClick={() => setTipoMasivo("ingreso")}
                      className={tipoMasivo === "ingreso" ? "bg-green-600 hover:bg-green-700" : ""}
                    >
                      <ArrowDownCircle className="h-3.5 w-3.5 mr-1" /> Ingreso
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={tipoMasivo === "salida" ? "default" : "outline"}
                      onClick={() => setTipoMasivo("salida")}
                      className={tipoMasivo === "salida" ? "bg-red-600 hover:bg-red-700" : ""}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5 mr-1" /> Salida
                    </Button>
                  </div>
                </div>

                {/* Almacén */}
                <div className="space-y-2">
                  <Label className="text-sm">Almacén destino *</Label>
                  <Select value={almacenMasivo} onValueChange={handleAlmacenMasivoChange}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Seleccione almacén" />
                    </SelectTrigger>
                    <SelectContent>
                      {almacenes.map((a) => (
                        <SelectItem key={a.id} value={a.id!.toString()}>{a.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Localización */}
                <div className="space-y-2">
                  <Label className="text-sm flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> Localización *
                  </Label>
                  <Select
                    value={localizacionMasivo}
                    onValueChange={setLocalizacionMasivo}
                    disabled={!almacenMasivo}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder={almacenMasivo ? "Seleccione localización" : "Primero seleccione almacén"} />
                    </SelectTrigger>
                    <SelectContent>
                      {localizacionesMasivo.map((l) => (
                        <SelectItem key={l.id} value={l.id!.toString()}>{l.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Descargar plantilla */}
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">Formato: codigo_barras, cantidad, costo_unitario</p>
                  <a href="/api/emprendedor/plantilla-inventario" download>
                    <Button type="button" variant="outline" size="sm" className="w-full">
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Descargar plantilla
                    </Button>
                  </a>
                </div>

                {/* Cargar archivo */}
                <div className="space-y-2 pt-2">
                  <Label className="text-sm">Archivo Excel</Label>
                  <div
                    className="border-2 border-dashed border-amber-200 rounded-lg p-6 text-center cursor-pointer hover:bg-amber-50/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file) await handleExcelFile(file)
                    }}
                  >
                    <Upload className="h-8 w-8 mx-auto text-amber-400 mb-2" />
                    <p className="text-sm text-muted-foreground">Arrastra el archivo o haz click</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (file) await handleExcelFile(file)
                    }}
                  />
                </div>

                {filasExcel.length > 0 && (
                  <Button
                    type="button"
                    onClick={procesarMasivo}
                    disabled={procesando}
                    className={`w-full ${tipoMasivo === "ingreso" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                  >
                    {procesando ? (
                      <><Spinner className="h-4 w-4 mr-2" /> Procesando...</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" /> Procesar {filasExcel.length} filas</>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Preview de filas */}
            <Card className="md:col-span-2">
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Vista previa del archivo</span>
                  {filasExcel.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setFilasExcel([]); setErroresExcel([]); setResultadoMasivo(null) }}
                    >
                      <X className="h-4 w-4 mr-1" /> Limpiar
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                {/* Errores de parseo */}
                {erroresExcel.length > 0 && (
                  <Alert className="mb-4 border-red-200 bg-red-50">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertTitle className="text-red-800">Errores en el archivo</AlertTitle>
                    <AlertDescription>
                      <ul className="text-xs mt-1 space-y-1 text-red-700">
                        {erroresExcel.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Resultado del procesamiento */}
                {resultadoMasivo && (
                  <Alert className={`mb-4 ${resultadoMasivo.errores.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-800">
                      {resultadoMasivo.procesados} filas procesadas
                    </AlertTitle>
                    {resultadoMasivo.errores.length > 0 && (
                      <AlertDescription>
                        <ul className="text-xs mt-1 space-y-1 text-amber-700">
                          {resultadoMasivo.errores.map((e, i) => <li key={i}>• {e}</li>)}
                        </ul>
                      </AlertDescription>
                    )}
                  </Alert>
                )}

                {filasExcel.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <FileSpreadsheet className="h-12 w-12 mx-auto text-stone-300 mb-3" />
                    <p className="text-sm">Carga un archivo Excel para ver la vista previa</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Código de barras</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Costo unitario</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filasExcel.map((fila, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-sm">{fila.codigo_barras}</TableCell>
                          <TableCell className="text-right font-mono">{fila.cantidad}</TableCell>
                          <TableCell className="text-right font-mono">
                            {fila.costo_unitario != null ? `L ${fila.costo_unitario.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell>
                            {fila._error ? (
                              <Badge variant="destructive" className="text-xs">{fila._error}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-300">OK</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
