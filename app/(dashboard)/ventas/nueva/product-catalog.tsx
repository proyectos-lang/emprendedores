"use client"

import * as React from "react"
import Image from "next/image"
import {
  Search,
  LayoutGrid,
  List as ListIcon,
  Plus,
  Check,
  ImageIcon,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Trash2,
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { Producto, Marca, Categoria } from "@/lib/services/catalogos"

const VIEW_STORAGE_KEY = "pos.catalogo.view"
const STOCK_BAJO = 5
const PAGE_SIZE = 20
export const TODOS = "__todos__"

interface ProductCatalogProps {
  marcas: Marca[]
  categorias: Categoria[]
  idsEnVenta: number[]
  onAdd: (producto: Producto) => void
  disabled?: boolean
  localizacionSeleccionada?: boolean
  /** ID numérico de la localización activa (para detectar cambios y refrescar stock). */
  localizacionId?: number | null
  stockPorLocalizacion?: Record<number, number>
  loadingStock?: boolean
  /**
   * Fetches products from the server. Used for both pagination (q='') and
   * search (q=user query). Returns data + total row count.
   */
  buscarFn: (
    q: string,
    catId: string,
    marcaId: string,
    page: number,
    pageSize: number
  ) => Promise<{ data: Producto[]; total: number }>
  /** Called with the IDs of the products currently visible, so the parent can fetch stock. */
  onPageLoad?: (ids: number[]) => void
}

export function ProductCatalog({
  marcas,
  categorias,
  idsEnVenta,
  onAdd,
  disabled,
  localizacionSeleccionada = false,
  localizacionId,
  stockPorLocalizacion,
  loadingStock = false,
  buscarFn,
  onPageLoad,
}: ProductCatalogProps) {
  const [view, setView] = React.useState<"grid" | "list">("grid")
  const [categoriaFiltro, setCategoriaFiltro] = React.useState<string>(TODOS)
  const [marcaFiltro, setMarcaFiltro] = React.useState<string>(TODOS)

  // ── Browse mode (no active search) ───────────────────────────────────────
  const [currentPage, setCurrentPage] = React.useState(1)
  const [pageData, setPageData] = React.useState<Producto[]>([])
  const [pageTotal, setPageTotal] = React.useState(0)
  const [loadingPage, setLoadingPage] = React.useState(false)

  // ── Search mode (committed when user clicks lupa or presses Enter) ────────
  const [searchInput, setSearchInput] = React.useState("")   // live text in the input
  const [activeSearch, setActiveSearch] = React.useState("") // committed query
  const [searchData, setSearchData] = React.useState<Producto[]>([])
  const [searchTotal, setSearchTotal] = React.useState(0)
  const [loadingSearch, setLoadingSearch] = React.useState(false)

  // ── Cola (selection queue, only active in search mode) ───────────────────
  const [cola, setCola] = React.useState<Producto[]>([])

  const isSearchMode = activeSearch !== ""

  // ── Persist view preference ───────────────────────────────────────────────
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY)
      if (saved === "grid" || saved === "list") setView(saved)
    } catch { /* no-op */ }
  }, [])

  function cambiarVista(next: "grid" | "list") {
    setView(next)
    try { localStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* no-op */ }
  }

  // Ref para onPageLoad — evita incluirlo en dep arrays y causar re-fetch en bucle
  const onPageLoadRef = React.useRef(onPageLoad)
  onPageLoadRef.current = onPageLoad

  // ── Load browse page ──────────────────────────────────────────────────────
  const loadBrowsePage = React.useCallback(async () => {
    setLoadingPage(true)
    try {
      const { data, total } = await buscarFn("", categoriaFiltro, marcaFiltro, currentPage, PAGE_SIZE)
      setPageData(data)
      setPageTotal(total)
      const ids = data.map((p) => p.id!).filter(Boolean)
      if (ids.length > 0) onPageLoadRef.current?.(ids)
    } catch { /* no-op */ }
    finally { setLoadingPage(false) }
  }, [buscarFn, categoriaFiltro, marcaFiltro, currentPage])

  React.useEffect(() => {
    if (isSearchMode) return
    loadBrowsePage()
  }, [isSearchMode, loadBrowsePage])

  // Reset to page 1 when buscarFn changes (emprendimiento filter changed in parent)
  React.useEffect(() => {
    setCurrentPage(1)
    setActiveSearch("")
    setSearchInput("")
    setCola([])
  }, [buscarFn])

  // Reset page when category/marca filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [categoriaFiltro, marcaFiltro])

  // ── Load search results ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!isSearchMode) return
    let cancelled = false
    setLoadingSearch(true)
    buscarFn(activeSearch, categoriaFiltro, marcaFiltro, 1, 80)
      .then(({ data, total }) => {
        if (cancelled) return
        setSearchData(data)
        setSearchTotal(total)
        const ids = data.map((p) => p.id!).filter(Boolean)
        if (ids.length > 0) onPageLoadRef.current?.(ids)
      })
      .catch(() => { /* no-op */ })
      .finally(() => { if (!cancelled) setLoadingSearch(false) })
    return () => { cancelled = true }
  }, [isSearchMode, activeSearch, categoriaFiltro, marcaFiltro, buscarFn])

  // ── Refresh stock when location changes ──────────────────────────────────
  const prevLocRef = React.useRef<number | null | undefined>(undefined)
  React.useEffect(() => {
    if (localizacionId === prevLocRef.current) return
    prevLocRef.current = localizacionId ?? null
    if (!localizacionId) return
    const visibleIds = isSearchMode
      ? searchData.map((p) => p.id!).filter(Boolean)
      : pageData.map((p) => p.id!).filter(Boolean)
    if (visibleIds.length > 0) onPageLoadRef.current?.(visibleIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizacionId])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getStock = React.useCallback(
    (p: Producto): number => {
      if (localizacionSeleccionada) return stockPorLocalizacion?.[p.id!] ?? 0
      return p.stock_total ?? 0
    },
    [localizacionSeleccionada, stockPorLocalizacion]
  )

  function commitSearch() {
    const q = searchInput.trim()
    if (!q) return
    setActiveSearch(q)
  }

  function clearSearch() {
    setSearchInput("")
    setActiveSearch("")
    setSearchData([])
    setSearchTotal(0)
    setCola([])
  }

  function addToCola(p: Producto) {
    setCola((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
  }

  function removeFromCola(id: number) {
    setCola((prev) => prev.filter((p) => p.id !== id))
  }

  function confirmarCola() {
    cola.forEach((p) => onAdd(p))
    setCola([])
    clearSearch()
  }

  const totalPages = Math.ceil(pageTotal / PAGE_SIZE)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 h-full min-h-0">

      {/* ── Barra de búsqueda ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 flex gap-1">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitSearch() }}
              placeholder="Buscar por nombre o código de barras..."
              className="pr-8"
            />
            {searchInput && (
              <button
                type="button"
                className="absolute right-[2.75rem] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={clearSearch}
                tabIndex={-1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <Button
              type="button"
              variant="default"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={commitSearch}
              disabled={!searchInput.trim()}
              title="Buscar"
            >
              {loadingSearch ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5 shrink-0">
            <Button
              type="button"
              variant={view === "grid" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => cambiarVista("grid")}
              title="Vista de mosaico"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={view === "list" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => cambiarVista("list")}
              title="Vista de lista"
              aria-pressed={view === "list"}
            >
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todas las categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={marcaFiltro} onValueChange={setMarcaFiltro}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Marca" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todas las marcas</SelectItem>
              {marcas.map((m) => (
                <SelectItem key={m.id} value={String(m.id)} className="text-xs">{m.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Leyenda de estado */}
        <p className="text-[11px] text-muted-foreground px-0.5 h-4">
          {isSearchMode ? (
            loadingSearch ? "Buscando..." : (
              <>
                {searchTotal} resultado{searchTotal !== 1 ? "s" : ""} para «{activeSearch}»
                {searchTotal > 80 && " · muestra los primeros 80 — refina la búsqueda"}
                <button
                  type="button"
                  onClick={clearSearch}
                  className="ml-2 underline hover:no-underline"
                >
                  limpiar
                </button>
              </>
            )
          ) : loadingPage ? (
            "Cargando..."
          ) : (
            `${pageTotal.toLocaleString()} producto${pageTotal !== 1 ? "s" : ""} · página ${currentPage} de ${Math.max(1, totalPages)}`
          )}
        </p>
      </div>

      {/* ── Lista de resultados ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {(loadingPage && !isSearchMode) || (loadingSearch && isSearchMode) ? (
          <div className="h-full min-h-40 flex flex-col items-center justify-center text-muted-foreground gap-2 py-10">
            <Loader2 className="h-8 w-8 animate-spin opacity-40" />
            <p className="text-sm">{isSearchMode ? "Buscando productos..." : "Cargando catálogo..."}</p>
          </div>
        ) : loadingStock && !isSearchMode ? (
          <div className="h-full min-h-40 flex flex-col items-center justify-center text-muted-foreground gap-2 py-10">
            <Loader2 className="h-8 w-8 animate-spin opacity-40" />
            <p className="text-sm">Cargando disponibilidad...</p>
          </div>
        ) : (isSearchMode ? searchData : pageData).length === 0 ? (
          <div className="h-full min-h-40 flex flex-col items-center justify-center text-muted-foreground gap-2 py-10">
            <ImageIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              {isSearchMode
                ? "No se encontraron productos para esa búsqueda."
                : localizacionSeleccionada
                ? "No hay productos disponibles en esta localización."
                : "No hay productos en el catálogo."}
            </p>
          </div>
        ) : view === "grid" ? (
          <ProductGrid
            productos={isSearchMode ? searchData : pageData}
            idsEnVenta={idsEnVenta}
            cola={isSearchMode ? cola.map((p) => p.id!) : []}
            onAdd={isSearchMode ? addToCola : onAdd}
            disabled={disabled}
            getStock={getStock}
            searchMode={isSearchMode}
          />
        ) : (
          <ProductTable
            productos={isSearchMode ? searchData : pageData}
            idsEnVenta={idsEnVenta}
            cola={isSearchMode ? cola.map((p) => p.id!) : []}
            onAdd={isSearchMode ? addToCola : onAdd}
            disabled={disabled}
            getStock={getStock}
            searchMode={isSearchMode}
          />
        )}
      </div>

      {/* ── Cola de selección (solo en modo búsqueda) ─────────────────────── */}
      {isSearchMode && cola.length > 0 && (
        <div className="border rounded-lg bg-primary/5 p-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5" />
              Cola de selección ({cola.length})
            </p>
            <Button
              type="button"
              size="sm"
              onClick={confirmarCola}
              disabled={disabled}
              className="h-7 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar {cola.length} al carrito
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cola.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[11px] px-2 py-0.5 font-medium max-w-[180px]"
              >
                <span className="truncate">{p.nombre}</span>
                <button
                  type="button"
                  onClick={() => removeFromCola(p.id!)}
                  className="shrink-0 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Paginación (solo en modo browse) ────────────────────────────────── */}
      {!isSearchMode && totalPages > 1 && (
        <div className="flex items-center justify-between shrink-0 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 h-8"
            disabled={currentPage === 1 || loadingPage}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 h-8"
            disabled={currentPage >= totalPages || loadingPage}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Shared list component types ───────────────────────────────────────────────

interface ListProps {
  productos: Producto[]
  idsEnVenta: number[]
  cola: number[]
  onAdd: (p: Producto) => void
  disabled?: boolean
  getStock: (p: Producto) => number
  searchMode: boolean
}

function stockClass(stock: number): string {
  return stock <= STOCK_BAJO ? "text-red-600" : "text-emerald-600"
}

function ProductImage({ url, nombre, className }: { url?: string | null; nombre: string; className?: string }) {
  const [errored, setErrored] = React.useState(false)
  if (!url || errored) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="h-1/3 w-1/3 opacity-40" />
      </div>
    )
  }
  return (
    <Image
      src={url}
      alt={nombre}
      width={160}
      height={160}
      unoptimized
      onError={() => setErrored(true)}
      className={cn("object-cover", className)}
    />
  )
}

// ── Grid view ─────────────────────────────────────────────────────────────────

function ProductGrid({ productos, idsEnVenta, cola, onAdd, disabled, getStock, searchMode }: ListProps) {
  return (
    <div className="grid grid-cols-3 min-[480px]:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {productos.map((p) => {
        const enVenta = idsEnVenta.includes(p.id!)
        const enCola = cola.includes(p.id!)
        const stock = getStock(p)
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(p)}
            className={cn(
              "group relative flex flex-col rounded-md border bg-card text-left overflow-hidden transition-colors",
              "hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              enVenta && !searchMode && "border-primary",
              enCola && "border-primary bg-primary/5"
            )}
          >
            <div className="relative h-14 w-full shrink-0">
              <ProductImage url={p.foto_url} nombre={p.nombre} className="h-full w-full" />
              {((enVenta && !searchMode) || enCola) && (
                <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 min-w-0">
              <p className="text-[11px] font-medium leading-tight line-clamp-2 break-words">{p.nombre}</p>
              {p.codigo_barras && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">{p.codigo_barras}</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 mt-0.5">
                <span className="text-[11px] font-bold text-primary whitespace-nowrap">
                  L {(p.precio_venta_sugerido ?? 0).toFixed(2)}
                </span>
                <span className={cn("text-[10px] font-medium whitespace-nowrap", stockClass(stock))}>
                  {stock}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── List / table view ─────────────────────────────────────────────────────────

function ProductTable({ productos, idsEnVenta, cola, onAdd, disabled, getStock, searchMode }: ListProps) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-2 sm:px-3 py-2 w-12">Foto</th>
            <th className="text-left font-medium px-2 sm:px-3 py-2">Nombre</th>
            <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Codigo</th>
            <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Marca</th>
            <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Categoria</th>
            <th className="text-right font-medium px-2 sm:px-3 py-2">Stock</th>
            <th className="text-right font-medium px-2 sm:px-3 py-2">Precio</th>
            <th className="px-2 sm:px-3 py-2 w-12" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {productos.map((p) => {
            const enVenta = idsEnVenta.includes(p.id!)
            const enCola = cola.includes(p.id!)
            const stock = getStock(p)
            return (
              <tr key={p.id} className={cn("hover:bg-muted/40", enCola && "bg-primary/5")}>
                <td className="px-2 sm:px-3 py-2">
                  <ProductImage url={p.foto_url} nombre={p.nombre} className="h-9 w-9 rounded-md shrink-0" />
                </td>
                <td className="px-2 sm:px-3 py-2 max-w-[10rem]">
                  <span className="font-medium line-clamp-2 break-words">{p.nombre}</span>
                  {enVenta && !searchMode && <Badge variant="secondary" className="mt-1 text-[10px]">En venta</Badge>}
                  {enCola && <Badge variant="default" className="mt-1 text-[10px]">En cola</Badge>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                  {p.codigo_barras || "-"}
                </td>
                <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{p.marca_nombre || "-"}</td>
                <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{p.categoria_nombre || "-"}</td>
                <td className={cn("px-2 sm:px-3 py-2 text-right font-medium whitespace-nowrap", stockClass(stock))}>
                  {stock}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right font-bold text-primary whitespace-nowrap">
                  L {(p.precio_venta_sugerido ?? 0).toFixed(2)}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right">
                  <Button
                    type="button"
                    size="icon"
                    variant={enCola ? "default" : "outline"}
                    className="h-8 w-8"
                    disabled={disabled}
                    onClick={() => onAdd(p)}
                    title={searchMode ? (enCola ? "Quitar de la cola" : "Agregar a la cola") : "Agregar al carrito"}
                    aria-label={`${searchMode ? "Cola" : "Agregar"} ${p.nombre}`}
                  >
                    {enCola ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
