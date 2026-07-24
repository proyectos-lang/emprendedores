"use client"

import * as React from "react"
import {
  getMisProductos,
  actualizarProductoEmprendedor,
  type ProductoEditable,
} from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { Loader2, Search, Pencil, X, Package } from "lucide-react"

const MAX_NOMBRE = 200

export default function EditarProductosPage() {
  const [productos, setProductos] = React.useState<ProductoEditable[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [buscando, setBuscando] = React.useState(false)

  // Dialogo de edicion
  const [editando, setEditando] = React.useState<ProductoEditable | null>(null)
  const [formNombre, setFormNombre] = React.useState("")
  const [guardando, setGuardando] = React.useState(false)

  const cargar = React.useCallback(async (q?: string) => {
    const { data, error } = await getMisProductos(q)
    if (error) toast.error(error)
    setProductos(data)
  }, [])

  React.useEffect(() => {
    cargar().finally(() => setLoading(false))
  }, [cargar])

  async function handleBuscar() {
    setBuscando(true)
    await cargar(query)
    setBuscando(false)
  }

  async function handleLimpiar() {
    setQuery("")
    setBuscando(true)
    await cargar()
    setBuscando(false)
  }

  function abrirEdicion(p: ProductoEditable) {
    setEditando(p)
    setFormNombre(p.nombre)
  }

  async function handleGuardar() {
    if (!editando) return
    const nombre = formNombre.trim()
    if (!nombre) {
      toast.error("El nombre no puede estar vacio")
      return
    }

    setGuardando(true)
    const { error } = await actualizarProductoEmprendedor(editando.id, { nombre })
    setGuardando(false)

    if (error) {
      toast.error(error)
      return
    }

    // Reflejamos el cambio en la tabla sin recargar todo.
    setProductos((prev) =>
      prev.map((p) => (p.id === editando.id ? { ...p, nombre } : p))
    )
    toast.success("Nombre actualizado")
    setEditando(null)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">Editar productos</h1>
        <p className="text-sm text-stone-500 mt-1">
          Actualiza el nombre de tus productos. Los cambios se aplican de inmediato,
          sin necesidad de aprobacion.
        </p>
      </div>

      {/* Buscador */}
      <div className="flex gap-2 max-w-md">
        <Input
          placeholder="Buscar por nombre o codigo de barras..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleBuscar() }
          }}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleBuscar}
          disabled={buscando}
          className="shrink-0"
          title="Buscar"
        >
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleLimpiar}
            disabled={buscando}
            className="shrink-0"
            title="Limpiar busqueda"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Listado */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
      ) : productos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-stone-400 gap-2">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">
            {query ? "No se encontraron productos con esa busqueda." : "Aun no tienes productos aprobados."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codigo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p) => (
                <TableRow key={p.id} className="hover:bg-stone-50/60">
                  <TableCell className="font-mono text-xs text-stone-500 whitespace-nowrap">
                    {p.codigo_barras || "—"}
                  </TableCell>
                  <TableCell className="font-medium text-stone-800">{p.nombre}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-stone-600">
                    L {p.precio_venta_sugerido.toLocaleString("es")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => abrirEdicion(p)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogo de edicion */}
      <Dialog open={!!editando} onOpenChange={(o) => { if (!o) setEditando(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar nombre del producto</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {editando?.codigo_barras || "Sin codigo de barras"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-nombre">
                Nombre <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-nombre"
                value={formNombre}
                onChange={(e) => setFormNombre(e.target.value)}
                maxLength={MAX_NOMBRE}
                placeholder="Nombre del producto"
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleGuardar() }
                }}
              />
              <p className="text-xs text-stone-400 text-right">
                {formNombre.length} / {MAX_NOMBRE}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              onClick={handleGuardar}
              disabled={guardando || !formNombre.trim()}
              className="text-white"
              style={{ background: "#78350f" }}
            >
              {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
