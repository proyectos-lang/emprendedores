import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { getHondurasNowISO } from '@/lib/utils/honduras-time'

// ==================== INTERFACES ====================

export interface Producto {
  id?: number
  nombre: string
  codigo_barras: string
  precio_venta_sugerido: number
  costo_promedio?: number
  stock_total?: number
  foto_url?: string
  marca_id?: number | null
  categoria_id?: number | null
  /** Opcional: el producto puede tener solo categoria principal. */
  subcategoria_id?: number | null
  /** FK al emprendimiento propietario del producto. NULL = tienda propia. */
  emprendimiento_id?: number | null
  marca_nombre?: string
  categoria_nombre?: string
  /** Nombre flat de la subcategoria (join virtual, no se persiste). */
  subcategoria_nombre?: string | null
  /** Nombre del emprendimiento (join virtual, no se persiste). */
  emprendimiento_nombre?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * Subcategoria: hija de una categoria principal. Multi-tenant: cada tenant
 * mantiene su propio arbol categoria -> subcategorias. La FK a categorias
 * usa ON DELETE CASCADE: borrar la categoria padre elimina sus hijas.
 */
export interface Subcategoria {
  id?: number
  nombre: string
  descripcion?: string | null
  categoria_id: number
  created_at?: string
}

export interface Marca {
  id?: number
  nombre: string
  created_at?: string
}

export interface Categoria {
  id?: number
  nombre: string
  created_at?: string
}

export interface Almacen {
  id?: number
  nombre: string
  ubicacion: string
  created_at?: string
}

export interface Localizacion {
  id?: number
  almacen_id: number
  nombre: string
  descripcion?: string
  created_at?: string
}

export interface Cliente {
  id?: number
  nombre: string  // required
  rtn?: string  // optional
  direccion?: string  // optional
  telefono?: string  // optional - contacto CRM
  /**
   * Fecha de nacimiento en formato ISO 'YYYY-MM-DD' (DATE en Postgres).
   * Usado para alertas de cumpleanos en el modulo de clientes.
   */
  fecha_nacimiento?: string
}

export interface Proveedor {
  id?: number
  nombre: string
  rtn: string
  contacto: string
  created_at?: string
}

// ==================== PRODUCTOS ====================

export interface GetProductosOpts {
  /** Página 1-indexada. Default: sin paginación (compatibilidad). */
  page?: number
  /** Tamaño de página. Default 50. */
  pageSize?: number
  /** Búsqueda por nombre o código de barras (ilike). */
  search?: string
  marcaId?: number | null
  categoriaId?: number | null
  emprendimientoId?: number | null
  /** true → solo productos sin emprendimiento (tienda propia) */
  soloTiendaPropia?: boolean
}

export async function getProductos(
  opts?: GetProductosOpts
): Promise<{ data: Producto[]; total: number; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const all: Producto[] = saved ? JSON.parse(saved) : []
    return { data: all, total: all.length, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], total: 0, error: 'Cliente no disponible' }

  function buildQuery(selectStr: string) {
    let q = supabase!
      .from('productos')
      .select(selectStr, { count: 'exact' })
      .order('codigo_barras', { ascending: true })

    if (opts?.search?.trim()) {
      const s = opts.search.trim()
      q = q.or(`nombre.ilike.%${s}%,codigo_barras.ilike.%${s}%`)
    }
    if (opts?.marcaId != null) q = q.eq('marca_id', opts.marcaId)
    if (opts?.categoriaId != null) q = q.eq('categoria_id', opts.categoriaId)
    if (opts?.soloTiendaPropia) {
      q = q.is('emprendimiento_id', null)
    } else if (opts?.emprendimientoId != null) {
      q = q.eq('emprendimiento_id', opts.emprendimientoId)
    }

    if (opts?.page != null) {
      const size = opts.pageSize ?? 50
      const pg = Math.max(1, opts.page)
      q = (q as any).range((pg - 1) * size, pg * size - 1)
    }
    return q
  }

  try {
    // Intentamos primero con el join a subcategorias (post-migracion 015).
    let result = await buildQuery(
      '*, marcas(nombre), categorias(nombre), subcategorias(nombre), emprendimientos(nombre)'
    )

    if (
      result.error &&
      /subcategoria|column.*does not exist|relation.*does not exist/i.test(
        result.error.message
      )
    ) {
      console.log('[v0][catalogos] subcategorias no disponibles, fallback sin join')
      result = await buildQuery(
        '*, marcas(nombre), categorias(nombre), emprendimientos(nombre)'
      )
    }

    if (result.error) return { data: [], total: 0, error: result.error.message }

    const rawProductos = result.data || []
    const productoIds = rawProductos.map((p: any) => p.id as number)

    // Fetch authoritative stock from the view for this page only
    let stockMap: Record<number, number> = {}
    if (productoIds.length > 0) {
      const { data: stockRows } = await supabase
        .from('vista_stock_por_localizacion')
        .select('producto_id, stock_actual')
        .in('producto_id', productoIds)
      ;(stockRows ?? []).forEach((row: any) => {
        stockMap[row.producto_id] = (stockMap[row.producto_id] ?? 0) + (row.stock_actual ?? 0)
      })
    }

    const productos = rawProductos.map((p: any) => ({
      ...p,
      stock_total: stockMap[p.id] ?? 0,
      marca_nombre: p.marcas?.nombre || null,
      categoria_nombre: p.categorias?.nombre || null,
      subcategoria_nombre: p.subcategorias?.nombre || null,
      emprendimiento_nombre: p.emprendimientos?.nombre || null,
      marcas: undefined,
      categorias: undefined,
      subcategorias: undefined,
      emprendimientos: undefined,
    }))

    return { data: productos, total: result.count ?? 0, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo productos:', err)
    return { data: [], total: 0, error: 'Error de conexion' }
  }
}

export interface BuscarProductosOpts {
  categoriaId?: number | null
  marcaId?: number | null
  emprendimientoId?: number | null
  soloTiendaPropia?: boolean
  limit?: number
  /** Página 1-indexada. Si se provee, se usa range() en vez de limit(). */
  page?: number
  /** Tamaño de página cuando se usa `page`. Default 20. */
  pageSize?: number
}

/**
 * Búsqueda server-side de productos con filtros opcionales.
 * Devuelve máximo `limit` resultados (default 80).
 * Soporta 6000+ artículos sin degradación de rendimiento.
 */
export async function buscarProductos(
  query: string,
  opts?: BuscarProductosOpts
): Promise<{ data: Producto[]; total: number; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: [], total: 0, error: null }
  const supabase = createClient()
  if (!supabase) return { data: [], total: 0, error: 'Cliente no disponible' }

  try {
    let q = supabase
      .from('productos')
      .select('*, marcas(nombre), categorias(nombre), emprendimientos(nombre)', { count: 'exact' })
      .order('nombre', { ascending: true })

    if (query.trim()) {
      q = q.or(`nombre.ilike.%${query.trim()}%,codigo_barras.ilike.%${query.trim()}%`)
    }
    if (opts?.categoriaId != null) q = q.eq('categoria_id', opts.categoriaId)
    if (opts?.marcaId != null) q = q.eq('marca_id', opts.marcaId)
    if (opts?.soloTiendaPropia) {
      q = q.is('emprendimiento_id', null)
    } else if (opts?.emprendimientoId != null) {
      q = q.eq('emprendimiento_id', opts.emprendimientoId)
    }

    if (opts?.page != null) {
      const size = opts.pageSize ?? 20
      const pg = Math.max(1, opts.page)
      q = (q as any).range((pg - 1) * size, pg * size - 1)
    } else {
      q = q.limit(opts?.limit ?? 80)
    }

    const { data, error, count } = await q
    if (error) return { data: [], total: 0, error: error.message }

    const productos = (data || []).map((p: any) => ({
      ...p,
      marca_nombre: p.marcas?.nombre || null,
      categoria_nombre: p.categorias?.nombre || null,
      subcategoria_nombre: null,
      emprendimiento_nombre: p.emprendimientos?.nombre || null,
      marcas: undefined,
      categorias: undefined,
      emprendimientos: undefined,
    }))
    return { data: productos, total: count ?? 0, error: null }
  } catch {
    return { data: [], total: 0, error: 'Error de conexion' }
  }
}

/**
 * Busca un producto por código de barras exacto (case-insensitive) y devuelve
 * el stock real desde vista_stock_por_localizacion. Devuelve null si no existe.
 */
export async function getProductoPorCodigo(
  codigo: string
): Promise<{ data: Producto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const all: Producto[] = saved ? JSON.parse(saved) : []
    const found = all.find(p => p.codigo_barras?.toLowerCase() === codigo.toLowerCase())
    return { data: found ?? null, error: found ? null : 'Producto no encontrado' }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*, marcas(nombre), categorias(nombre), emprendimientos(nombre)')
      .ilike('codigo_barras', codigo.trim())
      .limit(1)
      .maybeSingle()

    if (error) return { data: null, error: error.message }
    if (!data) return { data: null, error: 'Producto no encontrado' }

    const { data: stockRows } = await supabase
      .from('vista_stock_por_localizacion')
      .select('stock_actual')
      .eq('producto_id', data.id)

    const stockTotal = (stockRows ?? []).reduce(
      (sum: number, row: any) => sum + (row.stock_actual ?? 0), 0
    )

    const producto: Producto = {
      ...data,
      stock_total: stockTotal,
      costo_promedio: data.costo_promedio ?? 0,
      marca_nombre: data.marcas?.nombre ?? null,
      categoria_nombre: data.categorias?.nombre ?? null,
      emprendimiento_nombre: data.emprendimientos?.nombre ?? null,
      marcas: undefined,
      categorias: undefined,
      emprendimientos: undefined,
    }
    return { data: producto, error: null }
  } catch {
    return { data: null, error: 'Error de conexión' }
  }
}

/**
 * Busca un producto por ID exacto y devuelve el stock real desde
 * vista_stock_por_localizacion. Mismo patron que getProductoPorCodigo,
 * pero por ID — usado cuando el usuario elige un producto de una lista
 * de resultados (busqueda por nombre) en vez de escribir el codigo exacto.
 */
export async function getProductoPorId(
  id: number
): Promise<{ data: Producto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const all: Producto[] = saved ? JSON.parse(saved) : []
    const found = all.find(p => p.id === id)
    return { data: found ?? null, error: found ? null : 'Producto no encontrado' }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*, marcas(nombre), categorias(nombre), emprendimientos(nombre)')
      .eq('id', id)
      .maybeSingle()

    if (error) return { data: null, error: error.message }
    if (!data) return { data: null, error: 'Producto no encontrado' }

    const { data: stockRows } = await supabase
      .from('vista_stock_por_localizacion')
      .select('stock_actual')
      .eq('producto_id', data.id)

    const stockTotal = (stockRows ?? []).reduce(
      (sum: number, row: any) => sum + (row.stock_actual ?? 0), 0
    )

    const producto: Producto = {
      ...data,
      stock_total: stockTotal,
      costo_promedio: data.costo_promedio ?? 0,
      marca_nombre: data.marcas?.nombre ?? null,
      categoria_nombre: data.categorias?.nombre ?? null,
      emprendimiento_nombre: data.emprendimientos?.nombre ?? null,
      marcas: undefined,
      categorias: undefined,
      emprendimientos: undefined,
    }
    return { data: producto, error: null }
  } catch {
    return { data: null, error: 'Error de conexión' }
  }
}

export async function saveProducto(
  producto: Producto,
  isNew: boolean
): Promise<{ data: Producto | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const productos: Producto[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newProducto = { ...producto, id: Date.now() }
      productos.push(newProducto)
      localStorage.setItem('productos', JSON.stringify(productos))
      return { data: newProducto, error: null }
    } else {
      const idx = productos.findIndex(p => p.id === producto.id)
      if (idx >= 0) productos[idx] = producto
      localStorage.setItem('productos', JSON.stringify(productos))
      return { data: producto, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    // Strip join-only fields before sending to DB.
    const {
      marca_nombre,
      categoria_nombre,
      subcategoria_nombre,
      emprendimiento_nombre,
      ...cleanProducto
    } = producto

    // Si el cliente no asigno subcategoria, no la mandamos en el payload.
    // Asi el codigo sigue funcionando antes de aplicar la migracion 015
    // (cuando productos.subcategoria_id no existe todavia). Cuando si esta
    // asignada, se manda y se persiste normal.
    if (cleanProducto.subcategoria_id == null) {
      delete (cleanProducto as { subcategoria_id?: number | null }).subcategoria_id
    }
    
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[v0][saveProducto] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...productoData } = cleanProducto
      const { data, error } = await supabase
        .from('productos')
        .insert({ ...productoData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Strip id, created_at, stock_total, costo_promedio (read-only/auto) from the UPDATE payload
      const { id, created_at, stock_total, costo_promedio, ...updateData } = cleanProducto
      const { data, error } = await supabase
        .from('productos')
        .update({ ...updateData, updated_at: getHondurasNowISO() })
        .eq('id', id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando producto:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteProducto(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('productos')
    const productos: Producto[] = saved ? JSON.parse(saved) : []
    const filtered = productos.filter(p => p.id !== id)
    localStorage.setItem('productos', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('productos').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando producto:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

export async function uploadProductoImage(file: File): Promise<{ url: string | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { url: URL.createObjectURL(file), error: null }
  }

  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload-imagen', {
      method: 'POST',
      body: formData
    })

    const json = await res.json()

    if (!res.ok) {
      return { url: null, error: json.error || 'Error al subir imagen' }
    }

    return { url: json.url, error: null }
  } catch (err) {
    console.error('[Upload] Error subiendo imagen:', err)
    return { url: null, error: 'Error subiendo imagen' }
  }
}

// ==================== MARCAS ====================

export async function getMarcas(): Promise<{ data: Marca[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('marcas')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('marcas')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo marcas:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createMarca(nombre: string): Promise<{ data: Marca | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('marcas')
    const marcas: Marca[] = saved ? JSON.parse(saved) : []
    const newMarca = { id: Date.now(), nombre }
    marcas.push(newMarca)
    localStorage.setItem('marcas', JSON.stringify(marcas))
    return { data: newMarca, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[v0][createMarca] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    const { data, error } = await supabase
      .from('marcas')
      .insert({ nombre, ...stamp })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando marca:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== CATEGORIAS ====================

export async function getCategorias(): Promise<{ data: Categoria[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('categorias')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo categorias:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createCategoria(nombre: string): Promise<{ data: Categoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('categorias')
    const categorias: Categoria[] = saved ? JSON.parse(saved) : []
    const newCategoria = { id: Date.now(), nombre }
    categorias.push(newCategoria)
    localStorage.setItem('categorias', JSON.stringify(categorias))
    return { data: newCategoria, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[v0][createCategoria] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    const { data, error } = await supabase
      .from('categorias')
      .insert({ nombre, ...stamp })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando categoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== SUBCATEGORIAS ====================

/**
 * Lista subcategorias. Si se pasa `categoriaId` filtra a las hijas de esa
 * categoria (UI de cascada en el form de productos). Sin filtro, devuelve
 * todas las del tenant para la vista de Gestion de Categorias.
 *
 * Resiliente al pre-015: si la tabla aun no existe, regresa lista vacia
 * sin error para que la UI siga funcionando.
 */
export async function getSubcategorias(
  categoriaId?: number
): Promise<{ data: Subcategoria[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    let subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    if (categoriaId != null) {
      subs = subs.filter((s) => s.categoria_id === categoriaId)
    }
    return { data: subs, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase
      .from('subcategorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (categoriaId != null) {
      query = query.eq('categoria_id', categoriaId)
    }

    const { data, error } = await query

    if (error) {
      // Migracion 015 pendiente: degradamos silenciosamente.
      if (/relation.*does not exist/i.test(error.message)) {
        console.log('[v0][subcategorias] tabla no existe, devolviendo vacio')
        return { data: [], error: null }
      }
      return { data: [], error: error.message }
    }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo subcategorias:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function createSubcategoria(
  nombre: string,
  categoriaId: number,
  descripcion?: string
): Promise<{ data: Subcategoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const newSub: Subcategoria = {
      id: Date.now(),
      nombre,
      categoria_id: categoriaId,
      descripcion,
    }
    subs.push(newSub)
    localStorage.setItem('subcategorias', JSON.stringify(subs))
    return { data: newSub, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[v0][createSubcategoria] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // Inyectamos categoria_id + razon_social_id (del tenant stamp). El UNIQUE
    // compuesto en BD evitara duplicados dentro de la misma categoria/tenant.
    const { data, error } = await supabase
      .from('subcategorias')
      .insert({
        nombre,
        descripcion: descripcion ?? null,
        categoria_id: categoriaId,
        ...stamp,
      })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando subcategoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function updateSubcategoria(
  id: number,
  nombre: string,
  descripcion?: string | null
): Promise<{ data: Subcategoria | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const idx = subs.findIndex((s) => s.id === id)
    if (idx >= 0) {
      subs[idx] = { ...subs[idx], nombre, descripcion: descripcion ?? null }
      localStorage.setItem('subcategorias', JSON.stringify(subs))
      return { data: subs[idx], error: null }
    }
    return { data: null, error: 'No encontrada' }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('subcategorias')
      .update({
        nombre,
        descripcion: descripcion ?? null,
        updated_at: getHondurasNowISO(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data, error: null }
  } catch (err) {
    console.error('[Supabase] Error actualizando subcategoria:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteSubcategoria(
  id: number
): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('subcategorias')
    const subs: Subcategoria[] = saved ? JSON.parse(saved) : []
    const filtered = subs.filter((s) => s.id !== id)
    localStorage.setItem('subcategorias', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    // El FK productos.subcategoria_id usa ON DELETE SET NULL, asi que esto
    // no rompe la integridad: los productos que la usaban quedaran solo con
    // categoria principal.
    const { error } = await supabase.from('subcategorias').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando subcategoria:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== ALMACENES ====================

export async function getAlmacenes(): Promise<{ data: Almacen[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('almacenes')
      .select('*')
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo almacenes:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveAlmacen(
  almacen: Almacen,
  isNew: boolean
): Promise<{ data: Almacen | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    const almacenes: Almacen[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newAlmacen = { ...almacen, id: Date.now() }
      almacenes.push(newAlmacen)
      localStorage.setItem('almacenes', JSON.stringify(almacenes))
      return { data: newAlmacen, error: null }
    } else {
      const idx = almacenes.findIndex(a => a.id === almacen.id)
      if (idx >= 0) almacenes[idx] = almacen
      localStorage.setItem('almacenes', JSON.stringify(almacenes))
      return { data: almacen, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[v0][saveAlmacen] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...almacenData } = almacen
      const { data, error } = await supabase
        .from('almacenes')
        .insert({ ...almacenData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id (aislamiento) ni usuario
      // (historial del creador original). Solo datos funcionales.
      const { id, ...almacenData } = almacen
      const { data, error } = await supabase
        .from('almacenes')
        .update(almacenData)
        .eq('id', almacen.id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando almacen:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteAlmacen(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('almacenes')
    const almacenes: Almacen[] = saved ? JSON.parse(saved) : []
    const filtered = almacenes.filter(a => a.id !== id)
    localStorage.setItem('almacenes', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('almacenes').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando almacen:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== LOCALIZACIONES ====================

export async function getLocalizaciones(almacenId?: number): Promise<{ data: Localizacion[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    let localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    if (almacenId) {
      localizaciones = localizaciones.filter(l => l.almacen_id === almacenId)
    }
    return { data: localizaciones, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase.from('localizaciones').select('*').order('id', { ascending: true })
    
    if (almacenId) {
      query = query.eq('almacen_id', almacenId)
    }

    const { data, error } = await query
    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo localizaciones:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveLocalizacion(
  localizacion: Localizacion,
  isNew: boolean
): Promise<{ data: Localizacion | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    const localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newLocalizacion = { ...localizacion, id: Date.now() }
      localizaciones.push(newLocalizacion)
      localStorage.setItem('localizaciones', JSON.stringify(localizaciones))
      return { data: newLocalizacion, error: null }
    } else {
      const idx = localizaciones.findIndex(l => l.id === localizacion.id)
      if (idx >= 0) localizaciones[idx] = localizacion
      localStorage.setItem('localizaciones', JSON.stringify(localizaciones))
      return { data: localizacion, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[v0][saveLocalizacion] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...locData } = localizacion
      const { data, error } = await supabase
        .from('localizaciones')
        .insert({ ...locData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      const { id, ...locData } = localizacion
      const { data, error } = await supabase
        .from('localizaciones')
        .update(locData)
        .eq('id', localizacion.id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando localizacion:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteLocalizacion(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('localizaciones')
    const localizaciones: Localizacion[] = saved ? JSON.parse(saved) : []
    const filtered = localizaciones.filter(l => l.id !== id)
    localStorage.setItem('localizaciones', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('localizaciones').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando localizacion:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== CLIENTES ====================

export async function getClientes(): Promise<{ data: Cliente[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo clientes:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

/**
 * Limpia el payload de cliente antes de mandarlo a la BD:
 * - Cadenas vacias en campos opcionales -> null (Postgres acepta NULL en
 *   `fecha_nacimiento DATE`, pero rechaza "" con error de sintaxis).
 * - Trim a strings simples para no guardar espacios accidentales.
 * Devuelve un objeto del mismo shape de Cliente (omitiendo `id`).
 */
function sanitizeClientePayload(
  raw: Omit<Cliente, "id">
): Omit<Cliente, "id"> {
  const blank = (v: unknown) =>
    typeof v === "string" && v.trim() === "" ? null : v
  return {
    ...raw,
    nombre: typeof raw.nombre === "string" ? raw.nombre.trim() : raw.nombre,
    rtn: blank(raw.rtn) as Cliente["rtn"],
    direccion: blank(raw.direccion) as Cliente["direccion"],
    telefono: blank(raw.telefono) as Cliente["telefono"],
    // Critico: si viene "" lo convertimos a null antes de tocar la
    // columna DATE. Mantenemos el valor original si ya es null/undefined.
    fecha_nacimiento: blank(raw.fecha_nacimiento) as Cliente["fecha_nacimiento"],
  }
}

export async function saveCliente(
  cliente: Cliente,
  isNew: boolean
): Promise<{ data: Cliente | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    const clientes: Cliente[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newCliente = { ...cliente, id: Date.now() }
      clientes.push(newCliente)
      localStorage.setItem('clientes', JSON.stringify(clientes))
      return { data: newCliente, error: null }
    } else {
      const idx = clientes.findIndex(c => c.id === cliente.id)
      if (idx >= 0) clientes[idx] = cliente
      localStorage.setItem('clientes', JSON.stringify(clientes))
      return { data: cliente, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[v0][saveCliente] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...rawData } = cliente
      // Sanitiza campos opcionales: cadenas vacias -> null. Es critico
      // para `fecha_nacimiento` (columna DATE) porque Postgres rechaza
      // "" con `invalid input syntax for type date`. Aplicamos el mismo
      // criterio a rtn/direccion/telefono para no guardar strings vacios.
      const clienteData = sanitizeClientePayload(rawData)
      let { data, error } = await supabase
        .from('clientes')
        .insert({ ...clienteData, ...stamp })
        .select()
        .single()

      // Fallback: si las columnas `telefono`/`fecha_nacimiento` aun no
      // existen (migracion 010 pendiente), reintentamos sin esos campos
      // para no bloquear la creacion del cliente. El stamp con
      // razon_social_id se mantiene intacto.
      if (error && /telefono|fecha_nacimiento/i.test(error.message || '')) {
        console.warn(
          '[saveCliente] Columnas telefono/fecha_nacimiento ausentes. ' +
          'Aplica scripts/010-add-cliente-telefono-fecha-nacimiento.sql.'
        )
        const { telefono: _t, fecha_nacimiento: _f, ...clienteSinCRM } =
          clienteData
        const retry = await supabase
          .from('clientes')
          .insert({ ...clienteSinCRM, ...stamp })
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      const { id, ...rawData } = cliente
      const clienteData = sanitizeClientePayload(rawData)
      let { data, error } = await supabase
        .from('clientes')
        .update(clienteData)
        .eq('id', cliente.id)
        .select()
        .single()

      // Mismo fallback que en insert.
      if (error && /telefono|fecha_nacimiento/i.test(error.message || '')) {
        console.warn(
          '[saveCliente] Columnas telefono/fecha_nacimiento ausentes (update).'
        )
        const { telefono: _t, fecha_nacimiento: _f, ...clienteSinCRM } =
          clienteData
        const retry = await supabase
          .from('clientes')
          .update(clienteSinCRM)
          .eq('id', cliente.id)
          .select()
          .single()
        data = retry.data
        error = retry.error
      }

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando cliente:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteCliente(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('clientes')
    const clientes: Cliente[] = saved ? JSON.parse(saved) : []
    const filtered = clientes.filter(c => c.id !== id)
    localStorage.setItem('clientes', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('clientes').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando cliente:', err)
    return { success: false, error: 'Error de conexion' }
  }
}

// ==================== PROVEEDORES ====================

export async function getProveedores(): Promise<{ data: Proveedor[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo proveedores:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function saveProveedor(
  proveedor: Proveedor,
  isNew: boolean
): Promise<{ data: Proveedor | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    const proveedores: Proveedor[] = saved ? JSON.parse(saved) : []
    
    if (isNew) {
      const newProveedor = { ...proveedor, id: Date.now() }
      proveedores.push(newProveedor)
      localStorage.setItem('proveedores', JSON.stringify(proveedores))
      return { data: newProveedor, error: null }
    } else {
      const idx = proveedores.findIndex(p => p.id === proveedor.id)
      if (idx >= 0) proveedores[idx] = proveedor
      localStorage.setItem('proveedores', JSON.stringify(proveedores))
      return { data: proveedor, error: null }
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    if (isNew) {
      const stamp = await getTenantStamp(supabase)
      if (!isValidStamp(stamp)) {
        console.log('[v0][saveProveedor] Stamp invalido:', stamp)
        return { data: null, error: SESION_INVALIDA_ERROR }
      }

      const { id, ...proveedorData } = proveedor
      const { data, error } = await supabase
        .from('proveedores')
        .insert({ ...proveedorData, ...stamp })
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    } else {
      // Update: no tocamos razon_social_id ni usuario originales
      // (aislamiento e historial del creador).
      const { id, ...proveedorData } = proveedor
      const { data, error } = await supabase
        .from('proveedores')
        .update(proveedorData)
        .eq('id', proveedor.id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data, error: null }
    }
  } catch (err) {
    console.error('[Supabase] Error guardando proveedor:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function deleteProveedor(id: number): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('proveedores')
    const proveedores: Proveedor[] = saved ? JSON.parse(saved) : []
    const filtered = proveedores.filter(p => p.id !== id)
    localStorage.setItem('proveedores', JSON.stringify(filtered))
    return { success: true, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { success: false, error: 'Cliente no disponible' }

  try {
    const { error } = await supabase.from('proveedores').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err) {
    console.error('[Supabase] Error eliminando proveedor:', err)
    return { success: false, error: 'Error de conexion' }
  }
}
