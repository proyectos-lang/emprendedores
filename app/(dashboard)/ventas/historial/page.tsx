"use client"

import * as React from "react"
import { CreditCard, Download, FileSpreadsheet, Banknote, Wallet, Shuffle, Trash2, Loader2 } from "lucide-react"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  DialogFooter,
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
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { getClientes, getAlmacenes, getProductos, type Cliente, type Almacen, type Producto } from "@/lib/services/catalogos"
import { getEmprendimientos, type Emprendimiento } from "@/lib/services/emprendimientos"
import { useAuth } from "@/lib/contexts/auth-context"
import {
  getVentas,
  getDetallesVenta,
  getPagosVenta,
  registrarPago,
  eliminarVentaCompletamente,
  getRazonSocialForPdf,
  getDetalleAnalitico,
  getLineasVenta,
  eliminarLineaVenta,
  type VentaEncabezado,
  type VentaDetalle,
  type PagoVenta,
  type VentaDetalleAnalitico,
  type LineaVenta,
} from "@/lib/services/ventas"
import { getMetodosPagoPorVenta } from "@/lib/services/ventas-analytics"

export default function HistorialVentasPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const razonSocialId = user?.razon_social_id

  // --- Shared state ---
  const [loading, setLoading] = React.useState(true)
  const [ventas, setVentas] = React.useState<VentaEncabezado[]>([])
  const [clientes, setClientes] = React.useState<Cliente[]>([])
  const [almacenes, setAlmacenes] = React.useState<Almacen[]>([])
  const [productos, setProductos] = React.useState<Producto[]>([])
  const [emprendimientos, setEmprendimientos] = React.useState<Emprendimiento[]>([])
  /**
   * Map<venta_id, "Efectivo"|"Banco"|"Mixto"|"Credito"|"Otro">. Lo poblamos en
   * loadData con un solo query batch a ventas_pagos_detalle. Si la migracion
   * 011 esta pendiente, queda vacio y la columna muestra fallback "—".
   */
  const [metodosPago, setMetodosPago] = React.useState<Map<number, string>>(new Map())

  // --- Resumen de Facturas tab filters ---
  const [filtroFechaInicioFacturas, setFiltroFechaInicioFacturas] = React.useState("")
  const [filtroFechaFinFacturas, setFiltroFechaFinFacturas] = React.useState("")
  const [filtroClienteIdFacturas, setFiltroClienteIdFacturas] = React.useState("")
  const [filtroAlmacenIdFacturas, setFiltroAlmacenIdFacturas] = React.useState("")
  const [filtroEmprendimientoFacturas, setFiltroEmprendimientoFacturas] = React.useState("")
  const [filtroEstadoPago, setFiltroEstadoPago] = React.useState("")

  // --- Detalle por Producto tab filters ---
  const [filtroFechaInicio, setFiltroFechaInicio] = React.useState("")
  const [filtroFechaFin, setFiltroFechaFin] = React.useState("")

  // --- Detalle por Producto tab state ---
  const [loadingAnalitico, setLoadingAnalitico] = React.useState(false)
  const [detallesAnaliticos, setDetallesAnaliticos] = React.useState<VentaDetalleAnalitico[]>([])
  const [filtroClienteId, setFiltroClienteId] = React.useState("")
  const [filtroProductoId, setFiltroProductoId] = React.useState("")
  const [filtroAlmacenId, setFiltroAlmacenId] = React.useState("")
  const [analiticoLoaded, setAnaliticoLoaded] = React.useState(false)

  // --- Factura detail dialog ---
  const [selectedVenta, setSelectedVenta] = React.useState<VentaEncabezado | null>(null)
  const [detalles, setDetalles] = React.useState<VentaDetalle[]>([])
  const [pagos, setPagos] = React.useState<PagoVenta[]>([])
  const [showDetalleDialog, setShowDetalleDialog] = React.useState(false)

  // --- Pago dialog ---
  const [showPagoDialog, setShowPagoDialog] = React.useState(false)
  const [pagoMonto, setPagoMonto] = React.useState("")
  const [pagoMetodo, setPagoMetodo] = React.useState<string>("Efectivo")
  const [savingPago, setSavingPago] = React.useState(false)

  // --- Eliminar venta completa (alert dialog) ---
  const [ventaAEliminar, setVentaAEliminar] = React.useState<VentaEncabezado | null>(null)
  const [deletingVenta, setDeletingVenta] = React.useState(false)

  // --- Lineas de venta (historial línea por línea) ---
  const [lineas, setLineas] = React.useState<LineaVenta[]>([])
  const [pagLineas, setPagLineas] = React.useState(1)
  const PAGE_SIZE_LINEAS = 50

  // --- Eliminar línea individual ---
  const [lineaAEliminar, setLineaAEliminar] = React.useState<LineaVenta | null>(null)
  const [deletingLinea, setDeletingLinea] = React.useState(false)

  React.useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [ventasRes, clientesRes, almacenesRes, productosRes, empsData, lineasRes] = await Promise.all([
        getVentas(),
        getClientes(),
        getAlmacenes(),
        getProductos(),
        razonSocialId ? getEmprendimientos(razonSocialId) : Promise.resolve([]),
        getLineasVenta(),
      ])
      setVentas(ventasRes.data)
      setClientes(clientesRes.data)
      setAlmacenes(almacenesRes.data)
      setProductos(productosRes.data)
      setEmprendimientos((empsData as Emprendimiento[]).filter((e) => e.activo !== false))
      setLineas(lineasRes.data)

      const ids = ventasRes.data.map(v => v.id!).filter((id): id is number => id != null)
      if (ids.length > 0) {
        const { data: mapa } = await getMetodosPagoPorVenta(ids)
        setMetodosPago(mapa)
      } else {
        setMetodosPago(new Map())
      }
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar las ventas", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function loadAnalitico() {
    setLoadingAnalitico(true)
    try {
      const { data, error } = await getDetalleAnalitico(
        filtroFechaInicio || undefined,
        filtroFechaFin || undefined
      )
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      setDetallesAnaliticos(data)
      setAnaliticoLoaded(true)
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar los detalles", variant: "destructive" })
    } finally {
      setLoadingAnalitico(false)
    }
  }

  function handleTabChange(value: string) {
    if (value === "detalle" && !analiticoLoaded) {
      loadAnalitico()
    }
  }

  // --- Filtered line items for Resumen de Facturas (line-by-line view) ---
  const lineasFiltradas = React.useMemo(() => {
    const clienteSeleccionado = clientes.find(c => c.id?.toString() === filtroClienteIdFacturas)?.nombre || ""
    const almacenSeleccionado = almacenes.find(a => a.id?.toString() === filtroAlmacenIdFacturas)?.nombre || ""

    return lineas.filter(l => {
      const fecha = l.fecha_venta?.split('T')[0] || ""
      const matchInicio = !filtroFechaInicioFacturas || fecha >= filtroFechaInicioFacturas
      const matchFin = !filtroFechaFinFacturas || fecha <= filtroFechaFinFacturas
      const matchCliente = !filtroClienteIdFacturas || l.cliente_nombre === clienteSeleccionado
      const matchAlmacen = !filtroAlmacenIdFacturas || l.almacen_nombre === almacenSeleccionado
      const matchEstado = !filtroEstadoPago || l.estado_pago === filtroEstadoPago
      const matchEmprendimiento = !filtroEmprendimientoFacturas ||
        l.emprendimiento_nombre === filtroEmprendimientoFacturas
      return matchInicio && matchFin && matchCliente && matchAlmacen && matchEstado && matchEmprendimiento
    })
  }, [lineas, filtroFechaInicioFacturas, filtroFechaFinFacturas, filtroClienteIdFacturas, filtroAlmacenIdFacturas, filtroEstadoPago, filtroEmprendimientoFacturas, clientes, almacenes])

  // Reset to page 1 whenever any filter changes
  React.useEffect(() => { setPagLineas(1) }, [
    filtroFechaInicioFacturas, filtroFechaFinFacturas,
    filtroClienteIdFacturas, filtroAlmacenIdFacturas,
    filtroEstadoPago, filtroEmprendimientoFacturas,
  ])

  const totalPaginasLineas = Math.max(1, Math.ceil(lineasFiltradas.length / PAGE_SIZE_LINEAS))
  const lineasPagina = lineasFiltradas.slice(
    (pagLineas - 1) * PAGE_SIZE_LINEAS,
    pagLineas * PAGE_SIZE_LINEAS
  )

  // Totales de las columnas numéricas sobre todas las líneas filtradas
  const { sumaPrecioUnitNeto, sumaSubtotalFinal } = React.useMemo(() => {
    let sumaPrecioUnitNeto = 0
    let sumaSubtotalFinal = 0
    for (const l of lineasFiltradas) {
      const descEfectivo = (l.descuentodetalle ?? 0) > 0 ? (l.descuentodetalle ?? 0) : (l.descuento ?? 0)
      sumaPrecioUnitNeto += l.precio_neto_unitario
      sumaSubtotalFinal += (l.cantidad ?? 0) * l.precio_neto_unitario * (1 - descEfectivo / 100)
    }
    return { sumaPrecioUnitNeto, sumaSubtotalFinal }
  }, [lineasFiltradas])

  // ventasFiltradas kept for PDF generation compatibility
  const ventasFiltradas = React.useMemo(() => ventas, [ventas])

  // --- Filtered detalle analitico ---
  const detalleFiltrado = React.useMemo(() => {
    // Get selected names for dropdown filters
    const clienteSeleccionado = clientes.find(c => c.id?.toString() === filtroClienteId)?.nombre || ""
    const productoSeleccionado = productos.find(p => p.id?.toString() === filtroProductoId)?.nombre || ""
    const almacenSeleccionado = almacenes.find(a => a.id?.toString() === filtroAlmacenId)?.nombre || ""

    return detallesAnaliticos.filter(d => {
      // Dropdown filters
      const matchCliente = !filtroClienteId || d.cliente_nombre === clienteSeleccionado
      const matchProducto = !filtroProductoId || d.producto_nombre === productoSeleccionado
      const matchAlmacen = !filtroAlmacenId || d.almacen_nombre === almacenSeleccionado

      return matchCliente && matchProducto && matchAlmacen
    })
  }, [detallesAnaliticos, filtroClienteId, filtroProductoId, filtroAlmacenId, clientes, productos, almacenes])

  // --- Actions ---
  async function viewDetalle(venta: VentaEncabezado) {
    setSelectedVenta(venta)
    setShowDetalleDialog(true)
    const [detallesRes, pagosRes] = await Promise.all([
      getDetallesVenta(venta.id!),
      getPagosVenta(venta.id!),
    ])
    setDetalles(detallesRes.data)
    setPagos(pagosRes.data)
  }

  function openPagoDialog(venta: VentaEncabezado) {
    setSelectedVenta(venta)
    // Igual que en la tabla y el modal: el saldo real es
    // total_venta - valorpago (fuente de verdad en la cabecera).
    const pendiente = Math.max(
      0,
      (venta.total_venta ?? 0) - (venta.valorpago ?? 0)
    )
    setPagoMonto(pendiente.toFixed(2))
    setPagoMetodo("Efectivo")
    setShowPagoDialog(true)
  }

  async function handleRegistrarPago() {
    if (!selectedVenta || !pagoMonto) return
    setSavingPago(true)
    try {
      const { error } = await registrarPago({
        venta_id: selectedVenta.id!,
        monto: parseFloat(pagoMonto),
        metodo_pago: pagoMetodo,
      })
      if (error) { toast({ title: "Error", description: error, variant: "destructive" }); return }
      toast({ title: "Pago registrado", description: "El pago se registro correctamente" })
      setShowPagoDialog(false)
      setShowDetalleDialog(false)
      loadData()
    } catch {
      toast({ title: "Error", description: "Error al registrar el pago", variant: "destructive" })
    } finally {
      setSavingPago(false)
    }
  }

  async function handleEliminarVenta() {
    if (!ventaAEliminar?.id) return
    setDeletingVenta(true)
    try {
      const { error } = await eliminarVentaCompletamente(ventaAEliminar.id)
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      toast({
        title: "Venta eliminada",
        description: "Venta y movimientos asociados eliminados correctamente",
      })
      // Actualizacion optimista de la tabla: removemos la fila al instante
      // y disparamos un refetch para resincronizar metodos de pago/saldos.
      setVentas(prev => prev.filter(v => v.id !== ventaAEliminar.id))
      setVentaAEliminar(null)
      loadData()
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar la venta", variant: "destructive" })
    } finally {
      setDeletingVenta(false)
    }
  }

  async function handleEliminarLinea() {
    if (!lineaAEliminar) return
    setDeletingLinea(true)
    try {
      const { error } = await eliminarLineaVenta(
        lineaAEliminar.detalle_id,
        lineaAEliminar.venta_id,
        lineaAEliminar.producto_id,
        lineaAEliminar.cantidad
      )
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" })
        return
      }
      toast({ title: "Línea eliminada", description: "La línea y su movimiento de inventario fueron revertidos" })
      setLineas(prev => prev.filter(l => l.detalle_id !== lineaAEliminar.detalle_id))
      setLineaAEliminar(null)
      loadData()
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar la línea", variant: "destructive" })
    } finally {
      setDeletingLinea(false)
    }
  }

  function exportFacturasToExcel() {
    if (lineasFiltradas.length === 0) {
      toast({ title: "Sin datos", description: "No hay líneas para exportar", variant: "destructive" })
      return
    }
    const rows = lineasFiltradas.map(l => ({
      "Emprendimiento": l.emprendimiento_nombre ?? "",
      "N° Factura": l.numero_factura ?? "",
      "Fecha": l.fecha_venta?.split('T')[0] ?? "",
      "Cliente": l.cliente_nombre ?? "",
      "Almacén": l.almacen_nombre ?? "",
      "Estado": l.estado_pago ?? "",
      "Comisión Bancaria (%)": l.comisionbanc != null ? Number(l.comisionbanc) : 0,
      "Descuento (%)": (l.descuentodetalle ?? 0) > 0 ? (l.descuentodetalle ?? 0) : (l.descuento ?? 0),
      "Producto": l.producto_nombre ?? "",
      "Código": l.codigo_barras ?? "",
      "Cantidad": l.cantidad ?? 0,
      "Precio Unit. Bruto (L)": Number((l.precio_bruto_unitario ?? 0).toFixed(2)),
      "Precio Unit. Neto (L)": Number(l.precio_neto_unitario.toFixed(2)),
      "Subtotal Final (L)": Number((((l.cantidad ?? 0) * l.precio_neto_unitario) * (1 - ((l.descuentodetalle ?? 0) > 0 ? (l.descuentodetalle ?? 0) : (l.descuento ?? 0)) / 100)).toFixed(2)),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [
      { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 14 },
      { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Historial por Línea")
    XLSX.writeFile(wb, `Historial_Lineas_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast({ title: "Exportado", description: "Archivo Excel generado correctamente" })
  }

  function exportToExcel() {
    if (detalleFiltrado.length === 0) {
      toast({ title: "Sin datos", description: "No hay registros para exportar", variant: "destructive" })
      return
    }
    const rows = detalleFiltrado.map(d => ({
      "Fecha": d.fecha_venta?.split('T')[0] || "",
      "N° Factura": d.numero_factura,
      "Cliente": d.cliente_nombre,
      "Producto": d.producto_nombre,
      "SKU": d.producto_sku,
      "Cant.": d.cantidad,
      "Precio Unit. (L)": d.precio_unitario.toFixed(2),
      "Costo Unit. (L)": d.costo_promedio_momento.toFixed(2),
      "Utilidad Bruta (L)": d.utilidad_linea.toFixed(2),
      "Bodega": d.almacen_nombre,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [
      { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 14 },
      { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Detalle por Producto")
    XLSX.writeFile(wb, `Detalle_Ventas_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast({ title: "Exportado", description: "Archivo Excel generado correctamente" })
  }

  async function generatePdf(venta: VentaEncabezado) {
    const [detallesRes, razonSocial] = await Promise.all([
      getDetallesVenta(venta.id!),
      getRazonSocialForPdf(),
    ])
    const detallesVenta = detallesRes.data
    const cliente = clientes.find(c => c.id === venta.cliente_id)
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageWidth, pageHeight, "F")
    try {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.src = razonSocial?.logo_url || ""
      await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 1000) })
      if (img.complete && img.naturalWidth > 0) doc.addImage(img, "PNG", 20, 12, 50, 12)
    } catch { /* fallback */ }
    doc.setFontSize(9); doc.setTextColor(100, 100, 100)
    let cy = 32
    doc.text("Correo", 20, cy); doc.text("Telefono", 20, cy + 8); doc.text("Direccion", 20, cy + 16)
    doc.setTextColor(30, 30, 30)
    doc.text(razonSocial?.correo || "", 20, cy + 4)
    doc.text(razonSocial?.telefono || "", 20, cy + 12)
    doc.text((razonSocial?.direccion || "").substring(0, 35), 20, cy + 20)
    doc.setTextColor(100, 100, 100); doc.text("RTN", 80, cy)
    doc.setTextColor(30, 30, 30); doc.text(razonSocial?.documento || "N/A", 80, cy + 4)
    doc.setFontSize(28); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("FACTURA", pageWidth - 20, 28, { align: "right" })
    doc.setFontSize(12); doc.setFont("helvetica", "normal")
    doc.text(`#${venta.numero_factura}`, pageWidth - 20, 38, { align: "right" })
    const cY = 85
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5)
    doc.line(20, cY - 5, pageWidth - 20, cY - 5)
    doc.setFontSize(9); doc.setTextColor(100, 100, 100)
    doc.text("Cliente", 20, cY); doc.text("RTN Cliente", 80, cY); doc.text("Fecha", pageWidth - 60, cY)
    doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal")
    doc.text(cliente?.nombre || venta.cliente_nombre || "N/A", 20, cY + 6)
    doc.text(cliente?.rtn || "N/A", 80, cY + 6)
    doc.text(venta.fecha_venta?.split('T')[0] || "", pageWidth - 60, cY + 6)
    const descY = 110
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Descripcion", 20, descY)
    doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.8)
    doc.line(20, descY + 3, pageWidth - 20, descY + 3)
    let itemY = descY + 18
    doc.setFontSize(10); doc.setFont("helvetica", "normal")
    detallesVenta.forEach(d => {
      const descLinea = d.descuentodetalle ?? 0
      const sub = +((d.cantidad ?? 0) * (d.precio_unitario ?? 0) * (1 - descLinea / 100)).toFixed(2)
      doc.setTextColor(30, 30, 30)
      doc.text(`${d.producto_nombre || ""} (x${d.cantidad})`, 20, itemY)
      doc.text(`L ${sub.toFixed(2)}`, pageWidth - 20, itemY, { align: "right" })
      doc.setDrawColor(180, 180, 180); doc.setLineDashPattern([1, 1], 0)
      doc.line(20, itemY + 4, pageWidth - 20, itemY + 4)
      doc.setLineDashPattern([], 0)
      itemY += 12
    })
    const tY = Math.max(itemY + 15, 180)
    // subtotalFactura = suma de (precio × cant × (1 - desc%)) para cada línea
    const subtotalFactura = detallesVenta.reduce((acc, d) => {
      const desc = d.descuentodetalle ?? 0
      return acc + (d.cantidad ?? 0) * (d.precio_unitario ?? 0) * (1 - desc / 100)
    }, 0)
    // fallback para ventas antiguas con descuento global
    const descPctHist = Number(venta.descuento ?? 0)
    const descMontoHist = descPctHist > 0
      ? +((venta.subtotal ?? 0) * (descPctHist / 100)).toFixed(2)
      : +((venta.subtotal ?? 0) - subtotalFactura).toFixed(2)
    const hasDesc = descMontoHist > 0
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100)
    doc.text("Subtotal", pageWidth - 80, tY); doc.setTextColor(30, 30, 30)
    doc.text(`L ${(venta.subtotal ?? 0).toFixed(2)}`, pageWidth - 20, tY, { align: "right" })
    let tOff = 12
    if (hasDesc) {
      doc.setTextColor(100, 100, 100)
      doc.text(`Descuento`, pageWidth - 80, tY + tOff)
      doc.setTextColor(30, 30, 30)
      doc.text(`- L ${descMontoHist.toFixed(2)}`, pageWidth - 20, tY + tOff, { align: "right" })
      tOff += 12
    }
    doc.setTextColor(100, 100, 100)
    doc.text(`ISV (${venta.porcentaje_impuesto || 15}%)`, pageWidth - 80, tY + tOff)
    doc.setTextColor(30, 30, 30)
    doc.text(`L ${(venta.impuesto_total ?? 0).toFixed(2)}`, pageWidth - 20, tY + tOff, { align: "right" })
    doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Total", pageWidth - 80, tY + tOff + 14)
    doc.setFontSize(12)
    doc.text(`L ${(venta.total_venta ?? 0).toFixed(2)}`, pageWidth - 20, tY + tOff + 14, { align: "right" })
    const fY = pageHeight - 40
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5); doc.setLineDashPattern([], 0)
    doc.line(20, fY - 10, pageWidth - 20, fY - 10)
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Detalles de Pago", 20, fY)
    doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100); doc.setFontSize(8)
    doc.text(`RTN: ${razonSocial?.documento || "N/A"}`, 20, fY + 8)
    doc.text(`Tel: ${razonSocial?.telefono || "N/A"}`, 20, fY + 14)
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30)
    doc.text("Condiciones", 110, fY)
    doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100); doc.setFontSize(8)
    doc.text("Gracias por su compra. Este documento", 110, fY + 8)
    doc.text("es valido como comprobante fiscal.", 110, fY + 14)
    doc.setFontSize(7); doc.setTextColor(168, 162, 158)
    doc.text("Generado por EasyCount", pageWidth / 2, pageHeight - 8, { align: "center" })
    try {
      const pdfBlob = doc.output("blob")
      const blobUrl = URL.createObjectURL(pdfBlob)
      const link = document.createElement("a")
      link.href = blobUrl; link.download = `Factura_${venta.numero_factura}.pdf`
      document.body.appendChild(link); link.click(); document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
      toast({ title: "PDF Generado", description: "La factura se descargo correctamente" })
    } catch {
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }

  /**
   * Pinta un badge compacto con el metodo de pago agregado de la venta.
   * Mapea las etiquetas del helper (Efectivo / Banco / Mixto / Credito / Otro)
   * a un icono + color consistente. Si no hay registro -> guion suave.
   */
  const getMetodoPagoBadge = (ventaId: number | undefined) => {
    if (ventaId == null) return <span className="text-stone-400">&mdash;</span>
    const tipo = metodosPago.get(ventaId)
    if (!tipo) return <span className="text-stone-400">&mdash;</span>

    switch (tipo) {
      case "Efectivo":
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 gap-1 font-normal">
            <Wallet className="h-3 w-3" /> Efectivo
          </Badge>
        )
      case "Banco":
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border border-blue-200 gap-1 font-normal">
            <Banknote className="h-3 w-3" /> Banco
          </Badge>
        )
      case "Mixto":
        return (
          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border border-purple-200 gap-1 font-normal">
            <Shuffle className="h-3 w-3" /> Mixto
          </Badge>
        )
      case "Credito":
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200 gap-1 font-normal">
            <CreditCard className="h-3 w-3" /> Credito
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="font-normal">
            Otro
          </Badge>
        )
    }
  }

  const getEstadoBadge = (estado: string) => {
    // Convencion de colores del modulo de cartera:
    //   Pagado  -> Verde  (liquidado)
    //   Parcial -> Amarillo (con abono parcial)
    //   Pendiente -> Rojo (sin pago)
    switch (estado) {
      case "Pagado":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Pagado</Badge>
      case "Parcial":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Parcial</Badge>
      default:
        return <Badge className="bg-red-500 hover:bg-red-600 text-white">Pendiente</Badge>
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  // ─── Saldo del modal ──────────────────────────────────────────────
  // Usamos `valorpago` (campo persistido en la cabecera de la venta) como
  // unica fuente de verdad para "cuanto se ha pagado". Esto coincide con
  // el calculo de la tabla principal (`saldo = total_venta - valorpago`)
  // y evita el desfase que ocurria al sumar solo los registros del array
  // `pagos`, que puede no incluir el pago inicial hecho al crear la venta.
  const totalPagado = selectedVenta ? selectedVenta.valorpago ?? 0 : 0
  const saldoPendiente = selectedVenta
    ? Math.max(0, (selectedVenta.total_venta ?? 0) - totalPagado)
    : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Historial de Ventas</h1>
        <p className="text-sm text-muted-foreground">Consulta y gestiona tus facturas</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="facturas" onValueChange={handleTabChange}>
        <TabsList className="bg-stone-100 border border-stone-200 rounded-xl p-1 h-auto">
          <TabsTrigger
            value="facturas"
            className="rounded-lg px-5 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-stone-900 text-stone-500"
          >
            Resumen de Facturas
          </TabsTrigger>
          <TabsTrigger
            value="detalle"
            className="rounded-lg px-5 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-stone-900 text-stone-500"
          >
            Detalle por Producto
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Resumen de Facturas ── */}
        <TabsContent value="facturas" className="mt-4 space-y-4">
          {/* Filtros */}
          <Card className="rounded-2xl shadow-sm border border-stone-200 bg-stone-50">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {/* Emprendimiento */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Emprendimiento</Label>
                  <Select value={filtroEmprendimientoFacturas || "all"} onValueChange={(v) => setFiltroEmprendimientoFacturas(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los emprendimientos</SelectItem>
                      {emprendimientos.map(e => (
                        <SelectItem key={e.id} value={e.nombre}>{e.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Fecha Inicio */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Inicio</Label>
                  <Input
                    type="date"
                    value={filtroFechaInicioFacturas}
                    onChange={e => setFiltroFechaInicioFacturas(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>

                {/* Fecha Fin */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Fin</Label>
                  <Input
                    type="date"
                    value={filtroFechaFinFacturas}
                    onChange={e => setFiltroFechaFinFacturas(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>

                {/* Cliente */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Cliente</Label>
                  <Select value={filtroClienteIdFacturas || "all"} onValueChange={(v) => setFiltroClienteIdFacturas(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los clientes</SelectItem>
                      {clientes.map(c => (
                        <SelectItem key={c.id} value={c.id!.toString()}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Almacen */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Almacén</Label>
                  <Select value={filtroAlmacenIdFacturas || "all"} onValueChange={(v) => setFiltroAlmacenIdFacturas(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los almacenes</SelectItem>
                      {almacenes.map(a => (
                        <SelectItem key={a.id} value={a.id!.toString()}>
                          {a.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Estado Pago */}
                <div>
                  <Label className="text-xs text-stone-600 mb-1.5 block">Estado Pago</Label>
                  <Select value={filtroEstadoPago || "all"} onValueChange={(v) => setFiltroEstadoPago(v === "all" ? "" : v)}>
                    <SelectTrigger className="bg-white border-stone-200">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="Pendiente">Pendiente</SelectItem>
                      <SelectItem value="Parcial">Parcial</SelectItem>
                      <SelectItem value="Pagado">Pagado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Acciones */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-stone-200 bg-white hover:bg-stone-100"
                    onClick={() => {
                      setFiltroFechaInicioFacturas("")
                      setFiltroFechaFinFacturas("")
                      setFiltroClienteIdFacturas("")
                      setFiltroAlmacenIdFacturas("")
                      setFiltroEmprendimientoFacturas("")
                      setFiltroEstadoPago("")
                    }}
                  >
                    Limpiar
                  </Button>
                  <Button
                    className="flex-1 gap-2 bg-stone-800 hover:bg-stone-900 text-white"
                    onClick={exportFacturasToExcel}
                    disabled={lineasFiltradas.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mobile */}
          <div className="block md:hidden space-y-3">
            {lineasFiltradas.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground rounded-2xl">No hay líneas de venta registradas</Card>
            ) : lineasPagina.map(linea => {
              const tieneComision = linea.comision_porcentaje > 0
              const descuentoEfectivo = (linea.descuentodetalle ?? 0) > 0 ? (linea.descuentodetalle ?? 0) : (linea.descuento ?? 0)
              const subtotalNeto = +((linea.cantidad ?? 0) * linea.precio_neto_unitario * (1 - descuentoEfectivo / 100)).toFixed(2)
              return (
                <Card key={linea.detalle_id} className="rounded-2xl shadow-sm border border-stone-200">
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <p className="font-mono font-medium text-primary text-sm">{linea.numero_factura}</p>
                        <p className="text-xs text-muted-foreground">{linea.fecha_venta?.split('T')[0] || ''}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {getEstadoBadge(linea.estado_pago)}
                        {linea.comisionbanc != null && linea.comisionbanc > 0 ? (
                          <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                            Com. {linea.comisionbanc}%
                          </span>
                        ) : (
                          <span className="text-xs text-stone-400">Sin comisión</span>
                        )}
                        {descuentoEfectivo > 0 && (
                          <span className="text-xs font-medium text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">
                            Desc. {descuentoEfectivo}%
                          </span>
                        )}
                      </div>
                    </div>
                    {linea.emprendimiento_nombre && (
                      <p className="text-xs font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 inline-block mb-1">
                        {linea.emprendimiento_nombre}
                      </p>
                    )}
                    <p className="text-sm font-medium text-stone-800 truncate">{linea.producto_nombre}</p>
                    <p className="text-xs text-stone-500 truncate mb-2">{linea.cliente_nombre}</p>
                    <div className="flex justify-between items-center">
                      <div>
                        {tieneComision ? (
                          <>
                            <p className="text-xs text-stone-400 line-through">{linea.cantidad} × L {(linea.precio_bruto_unitario ?? 0).toFixed(2)}</p>
                            <p className="text-xs text-blue-600">−{linea.comision_porcentaje.toFixed(2)}% comisión banco</p>
                            <p className="font-bold text-base">L {subtotalNeto.toFixed(2)}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-stone-500">{linea.cantidad} × L {(linea.precio_bruto_unitario ?? 0).toFixed(2)}</p>
                            <p className="font-bold text-base">L {subtotalNeto.toFixed(2)}</p>
                          </>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => { const v = ventas.find(x => x.id === linea.venta_id); if (v) generatePdf(v) }}
                          title="Descargar PDF de la factura">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setLineaAEliminar(linea)}
                          title="Eliminar esta línea">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
            {/* Paginación mobile */}
            {lineasFiltradas.length > 0 && (
              <div className="flex items-center justify-between pt-1 pb-2 px-1">
                <span className="text-xs text-stone-500">
                  {(pagLineas - 1) * PAGE_SIZE_LINEAS + 1}–{Math.min(pagLineas * PAGE_SIZE_LINEAS, lineasFiltradas.length)} de {lineasFiltradas.length}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagLineas === 1} onClick={() => setPagLineas(p => p - 1)}>Anterior</Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagLineas >= totalPaginasLineas} onClick={() => setPagLineas(p => p + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </div>

          {/* Desktop */}
          <Card className="hidden md:block rounded-2xl shadow-sm border border-stone-200">
            <CardContent className="p-0">
              <div style={{ maxHeight: 480 }} className="overflow-y-auto">
                  <Table className="table-fixed w-full">
                    <TableHeader>
                      <TableRow className="bg-stone-50 border-b border-stone-200 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
                        <TableHead className="w-[10%] font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">Emprendimiento</TableHead>
                        <TableHead className="w-[7%]  font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">Fecha</TableHead>
                        <TableHead className="w-[8%]  font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">N° Factura</TableHead>
                        <TableHead className="w-[9%]  font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">Cliente</TableHead>
                        <TableHead className="w-[13%] font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">Producto</TableHead>
                        <TableHead className="w-[7%]  font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10 text-right">Com.</TableHead>
                        <TableHead className="w-[6%]  font-semibold text-stone-700 text-right sticky top-0 bg-stone-50 z-10">Desc.</TableHead>
                        <TableHead className="w-[4%]  font-semibold text-stone-700 text-right sticky top-0 bg-stone-50 z-10">Cant.</TableHead>
                        <TableHead className="w-[11%] font-semibold text-stone-700 text-right sticky top-0 bg-stone-50 z-10">
                          <div className="leading-tight">P. Unit. neto</div>
                          {lineasFiltradas.length > 0 && (
                            <div className="text-xs font-bold text-stone-900 border-t border-stone-300 mt-1 pt-1">
                              L {sumaPrecioUnitNeto.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="w-[10%] font-semibold text-stone-700 text-right sticky top-0 bg-stone-50 z-10">
                          <div className="leading-tight">Subtotal</div>
                          {lineasFiltradas.length > 0 && (
                            <div className="text-xs font-bold text-stone-900 border-t border-stone-300 mt-1 pt-1">
                              L {sumaSubtotalFinal.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="w-[8%]  font-semibold text-stone-700 sticky top-0 bg-stone-50 z-10">Estado</TableHead>
                        <TableHead className="w-[7%]  font-semibold text-stone-700 text-right sticky top-0 bg-stone-50 z-10">Acc.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineasFiltradas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center text-muted-foreground py-10">
                            No hay líneas de venta para mostrar
                          </TableCell>
                        </TableRow>
                      ) : lineasPagina.map(linea => {
                        const tieneComision = linea.comision_porcentaje > 0
                        const descuentoEfectivo = (linea.descuentodetalle ?? 0) > 0 ? (linea.descuentodetalle ?? 0) : (linea.descuento ?? 0)
              const subtotalNeto = +((linea.cantidad ?? 0) * linea.precio_neto_unitario * (1 - descuentoEfectivo / 100)).toFixed(2)
                        return (
                          <TableRow key={linea.detalle_id} className="hover:bg-stone-50/50">
                            <TableCell className="overflow-hidden max-w-0">
                              {linea.emprendimiento_nombre
                                ? <div className="truncate font-medium text-amber-700" title={linea.emprendimiento_nombre}>{linea.emprendimiento_nombre}</div>
                                : <span className="text-stone-400">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-stone-600">{linea.fecha_venta?.split('T')[0] || ''}</TableCell>
                            <TableCell className="font-mono font-medium whitespace-nowrap text-xs">{linea.numero_factura}</TableCell>
                            <TableCell className="overflow-hidden max-w-0">
                              <div className="truncate text-stone-600" title={linea.cliente_nombre ?? ''}>{linea.cliente_nombre}</div>
                            </TableCell>
                            <TableCell className="overflow-hidden max-w-0">
                              <div className="truncate font-medium text-stone-800" title={linea.producto_nombre ?? ''}>{linea.producto_nombre}</div>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {linea.comisionbanc != null && linea.comisionbanc > 0 ? (
                                <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                                  {linea.comisionbanc}%
                                </span>
                              ) : (
                                <span className="text-xs text-stone-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {descuentoEfectivo > 0 ? (
                                <span className="text-xs font-medium text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">
                                  {descuentoEfectivo}%
                                </span>
                              ) : (
                                <span className="text-xs text-stone-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-stone-600">{linea.cantidad}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {tieneComision ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="font-medium">L {linea.precio_neto_unitario.toFixed(2)}</span>
                                  <span className="text-xs text-blue-600">−{linea.comision_porcentaje.toFixed(2)}%</span>
                                  <span className="text-xs text-stone-400 line-through">L {(linea.precio_bruto_unitario ?? 0).toFixed(2)}</span>
                                </div>
                              ) : (
                                <span className="text-stone-600">L {(linea.precio_bruto_unitario ?? 0).toFixed(2)}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium whitespace-nowrap">
                              L {subtotalNeto.toFixed(2)}
                            </TableCell>
                            <TableCell>{getEstadoBadge(linea.estado_pago)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon"
                                  onClick={() => { const v = ventas.find(x => x.id === linea.venta_id); if (v) generatePdf(v) }}
                                  title="Descargar PDF de la factura">
                                  <Download className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setLineaAEliminar(linea)}
                                  title="Eliminar esta línea">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
              </div>
              {/* Paginación desktop */}
              {lineasFiltradas.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
                  <span className="text-xs text-stone-500">
                    {(pagLineas - 1) * PAGE_SIZE_LINEAS + 1}–{Math.min(pagLineas * PAGE_SIZE_LINEAS, lineasFiltradas.length)} de {lineasFiltradas.length} líneas
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs border-stone-200" disabled={pagLineas === 1} onClick={() => setPagLineas(p => p - 1)}>Anterior</Button>
                    <span className="flex items-center text-xs text-stone-500 px-1">{pagLineas} / {totalPaginasLineas}</span>
                    <Button variant="outline" size="sm" className="h-8 text-xs border-stone-200" disabled={pagLineas >= totalPaginasLineas} onClick={() => setPagLineas(p => p + 1)}>Siguiente</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Detalle por Producto ── */}
        <TabsContent value="detalle" className="mt-4 space-y-4">
          {/* Filtros y Resumen combinados */}
          <Card className="rounded-2xl shadow-sm border border-stone-200 bg-stone-50">
            <CardContent className="p-4 space-y-4">
              {/* Resumen en la parte superior */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm pb-4 border-b border-stone-200">
                <div>
                  <p className="text-stone-500 text-xs mb-1">Lineas</p>
                  <p className="font-semibold text-stone-800 text-lg">{detalleFiltrado.length}</p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Unidades Vendidas</p>
                  <p className="font-semibold text-stone-800 text-lg">{detalleFiltrado.reduce((a, d) => a + d.cantidad, 0)}</p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Ingresos Totales</p>
                  <p className="font-semibold text-stone-800 text-lg">
                    L {detalleFiltrado.reduce((a, d) => a + d.cantidad * d.precio_unitario, 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-stone-500 text-xs mb-1">Utilidad Total</p>
                  <p className="font-semibold text-emerald-700 text-lg">
                    L {detalleFiltrado.reduce((a, d) => a + d.utilidad_linea, 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Filtros y acciones */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {/* Filtro Fecha Inicio */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Inicio</Label>
                    <Input
                      type="date"
                      value={filtroFechaInicio}
                      onChange={e => setFiltroFechaInicio(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>

                  {/* Filtro Fecha Fin */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Fecha Fin</Label>
                    <Input
                      type="date"
                      value={filtroFechaFin}
                      onChange={e => setFiltroFechaFin(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>

                  {/* Filtro Cliente */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Cliente</Label>
                    <Select value={filtroClienteId || "all"} onValueChange={(v) => setFiltroClienteId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todos los clientes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los clientes</SelectItem>
                        {clientes.map(c => (
                          <SelectItem key={c.id} value={c.id!.toString()}>
                            {c.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Filtro Producto */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Producto</Label>
                    <Select value={filtroProductoId || "all"} onValueChange={(v) => setFiltroProductoId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todos los productos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los productos</SelectItem>
                        {productos.map(p => (
                          <SelectItem key={p.id} value={p.id!.toString()}>
                            {p.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Filtro Almacen */}
                  <div>
                    <Label className="text-xs text-stone-600 mb-1.5 block">Bodega</Label>
                    <Select value={filtroAlmacenId || "all"} onValueChange={(v) => setFiltroAlmacenId(v === "all" ? "" : v)}>
                      <SelectTrigger className="bg-white border-stone-200">
                        <SelectValue placeholder="Todas las bodegas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las bodegas</SelectItem>
                        {almacenes.map(a => (
                          <SelectItem key={a.id} value={a.id!.toString()}>
                            {a.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Botones de accion */}
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    className="border-stone-200 bg-white hover:bg-stone-100"
                    onClick={() => { 
                      setFiltroFechaInicio(""); 
                      setFiltroFechaFin(""); 
                      setFiltroClienteId(""); 
                      setFiltroProductoId(""); 
                      setFiltroAlmacenId(""); 
                    }}
                  >
                    Limpiar Filtros
                  </Button>
                  <Button
                    variant="outline"
                    className="border-stone-200 bg-white hover:bg-stone-100"
                    onClick={loadAnalitico}
                    disabled={loadingAnalitico}
                  >
                    {loadingAnalitico ? "Cargando..." : "Actualizar"}
                  </Button>
                  <Button
                    className="gap-2 bg-stone-800 hover:bg-stone-900 text-white"
                    onClick={exportToExcel}
                    disabled={detalleFiltrado.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Exportar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm border border-stone-200">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50 border-b border-stone-200">
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Fecha</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">N° Factura</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Cliente</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Producto</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">SKU</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Cant.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Precio Unit.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Costo Unit.</TableHead>
                    <TableHead className="font-semibold text-stone-700 text-right whitespace-nowrap">Utilidad Bruta</TableHead>
                    <TableHead className="font-semibold text-stone-700 whitespace-nowrap">Bodega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAnalitico ? (
                    [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(10)].map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : detalleFiltrado.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                        {analiticoLoaded ? "No hay registros para los filtros aplicados" : "Cargando datos..."}
                      </TableCell>
                    </TableRow>
                  ) : detalleFiltrado.map((d, idx) => (
                    <TableRow key={idx} className="hover:bg-stone-50/50">
                      <TableCell className="whitespace-nowrap">{d.fecha_venta?.split('T')[0] || ''}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">{d.numero_factura}</TableCell>
                      <TableCell className="whitespace-nowrap">{d.cliente_nombre}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{d.producto_nombre}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{d.producto_sku}</TableCell>
                      <TableCell className="text-right">{d.cantidad}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">L {d.precio_unitario.toFixed(2)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground">L {d.costo_promedio_momento.toFixed(2)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Badge className={d.utilidad_linea >= 0 ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-red-100 text-red-800 hover:bg-red-100"}>
                          L {d.utilidad_linea.toFixed(2)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{d.almacen_nombre}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>

      {/* Detalle Dialog */}
      <Dialog open={showDetalleDialog} onOpenChange={setShowDetalleDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg md:text-xl">Factura {selectedVenta?.numero_factura}</DialogTitle>
          </DialogHeader>
          {selectedVenta && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Cliente:</span>
                  <p className="font-medium">{selectedVenta.cliente_nombre}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Fecha:</span>
                  <p className="font-medium">{selectedVenta.fecha_venta?.split('T')[0] || ''}</p>
                </div>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalles.map(d => (
                      <TableRow key={d.id}>
                        <TableCell>
                          {d.producto_nombre}
                          {d.comentario && (
                            <p className="text-xs text-muted-foreground italic mt-0.5 break-words">
                              {d.comentario}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{d.cantidad}</TableCell>
                        <TableCell className="text-right">L {(d.precio_unitario ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">L {((d.cantidad ?? 0) * (d.precio_unitario ?? 0)).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end">
                <div className="w-48 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>L {(selectedVenta.subtotal ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ISV ({selectedVenta.porcentaje_impuesto || 15}%):</span>
                    <span>L {(selectedVenta.impuesto_total ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>Total:</span>
                    <span>L {(selectedVenta.total_venta ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Pagos Registrados</h4>
                {pagos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay pagos registrados</p>
                ) : (
                  <div className="space-y-2">
                    {pagos.map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm bg-muted/50 p-2 rounded">
                        <div>
                          <span className="font-medium">{p.metodo_pago}</span>
                          <span className="text-muted-foreground ml-2">{p.fecha_pago?.split('T')[0] || ''}</span>
                        </div>
                        <span className="font-medium text-green-600">L {(p.monto ?? 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 p-3 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                    <p className="text-lg font-bold text-primary">L {saldoPendiente.toFixed(2)}</p>
                  </div>
                  {saldoPendiente > 0 && (
                    <Button onClick={() => openPagoDialog(selectedVenta)}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Registrar Pago
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pago Dialog */}
      <Dialog open={showPagoDialog} onOpenChange={setShowPagoDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Monto</Label>
              <Input
                type="number" step="0.01" min="0" max={saldoPendiente}
                value={pagoMonto} onChange={e => setPagoMonto(e.target.value)} placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground mt-1">Saldo pendiente: L {saldoPendiente.toFixed(2)}</p>
            </div>
            <div>
              <Label>Metodo de Pago</Label>
              <Select value={pagoMetodo} onValueChange={setPagoMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo</SelectItem>
                  <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="Transferencia">Transferencia</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPagoDialog(false)}>Cancelar</Button>
            <Button onClick={handleRegistrarPago} disabled={savingPago}>
              {savingPago ? "Guardando..." : "Registrar Pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmacion de eliminacion de venta completa */}
      <AlertDialog
        open={ventaAEliminar !== null}
        onOpenChange={(open) => {
          if (!open && !deletingVenta) setVentaAEliminar(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">
              {ventaAEliminar
                ? `Eliminar venta ${ventaAEliminar.numero_factura}`
                : "Eliminar venta"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar esta venta? Esta acción devolverá los
              productos al inventario y eliminará los registros de caja y
              bancos. Es irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingVenta}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleEliminarVenta()
              }}
              disabled={deletingVenta}
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deletingVenta ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Eliminando...</>
              ) : (
                <><Trash2 className="h-4 w-4" />Eliminar venta</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmacion de eliminacion de línea */}
      <AlertDialog
        open={lineaAEliminar !== null}
        onOpenChange={(open) => {
          if (!open && !deletingLinea) setLineaAEliminar(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Eliminar línea de venta</AlertDialogTitle>
            <AlertDialogDescription>
              {lineaAEliminar && (
                <>
                  <span className="block font-medium text-stone-800 mb-1">
                    {lineaAEliminar.producto_nombre} — {lineaAEliminar.cantidad} unid.
                  </span>
                  <span className="block text-sm">
                    Factura <span className="font-mono">{lineaAEliminar.numero_factura}</span>
                    {lineaAEliminar.emprendimiento_nombre && ` · ${lineaAEliminar.emprendimiento_nombre}`}
                  </span>
                </>
              )}
              <span className="block mt-2">
                Esta acción eliminará la línea, revertirá el movimiento de inventario y
                ajustará los totales de la factura. Es irreversible.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLinea}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleEliminarLinea()
              }}
              disabled={deletingLinea}
              className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deletingLinea ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Eliminando...</>
              ) : (
                <><Trash2 className="h-4 w-4" />Eliminar línea</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
