import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { getTenantStamp, isValidStamp, SESION_INVALIDA_ERROR } from '@/lib/services/tenant-stamp'
import { registrarMovimientoCaja, getSesionAbierta, recomputarSaldosSesion } from '@/lib/services/caja-chica'
import { registrarMovimientoCuenta, recomputarSaldosCuenta } from '@/lib/services/cuentas'
import { getHondurasNowISO } from '@/lib/utils/honduras-time'

// ==================== INTERFACES ====================

export interface VentaEncabezado {
  id?: number
  numero_factura: string
  cliente_id: number
  cliente_nombre?: string  // joined from clientes table
  almacen_id?: number  // warehouse for this sale
  almacen_nombre?: string  // joined from almacenes table
  emprendimiento_nombre?: string | null  // joined via ventas_detalle → productos → emprendimientos
  fecha_venta?: string  // timestamp, defaults to now()
  aplica_impuesto: boolean  // default false
  porcentaje_impuesto: number  // default 15
  descuento?: number  // porcentaje de descuento 0-100 aplicado al subtotal
  subtotal: number  // default 0 (bruto, antes de descuento)
  impuesto_total: number  // default 0 (calculado sobre subtotal - descuento)
  total_venta: number  // default 0 (subtotal - descuento + impuesto)
  estado_pago: 'Pendiente' | 'Parcial' | 'Pagado'  // default 'Pendiente'
  /**
   * Total pagado acumulado de la venta. Al crear la venta se inicializa
   * segun el Tipo de Pago (Contado/Parcial/Credito) y se incrementa cada
   * vez que se registra un abono en `pagos_ventas`.
   * saldo_pendiente = total_venta - valorpago
   */
  valorpago?: number
  /**
   * Porcentaje de comision bancaria efectiva aplicado a esta venta (0..100).
   * Ejemplo: 3.5 significa 3.5%. Cuando es > 0, los precio_unitario en
   * ventas_detalle ya estan guardados como precio_bruto × (1 - comisionbanc/100).
   */
  comisionbanc?: number | null
  metodo_pago?: string | null
  /**
   * Venta a credito (migracion 022): descuenta inventario normalmente pero
   * la venta queda con valor 0 (sin ingreso monetario, sin CxC).
   */
  es_credito?: boolean
  /**
   * Envio (migracion 022): el flete NO se suma a la factura del cliente;
   * se descuenta de la liquidacion semanal del emprendedor.
   */
  es_envio?: boolean
  valor_flete?: number
}

export interface VentaDetalle {
  id?: number
  venta_id: number
  producto_id: number
  producto_nombre?: string  // joined from productos table (not stored)
  producto_codigo?: string  // joined from productos table (not stored)
  cantidad: number
  precio_unitario: number
  costo_promedio_momento: number
  utilidad_linea: number
  descuentodetalle?: number  // % descuento por línea (0-100), default 0
  /** Nota libre del vendedor sobre esta línea; visible para el emprendedor (migracion 025). */
  comentario?: string | null
}

export interface PagoVenta {
  id?: number
  venta_id: number
  fecha_pago?: string  // timestamp with time zone, defaults to now()
  monto: number
  metodo_pago: string  // text field
}

/**
 * Una linea del Desglose de Pago en Nueva Venta. Multiples lineas pueden
 * convivir en la misma venta (ej: 500 efectivo + 1000 BAC). La suma de
 * `monto_bruto` define `valorpago` y `estado_pago` de la venta.
 *
 *  - `metodo_pago`: tipo de pago.
 *  - `cuenta_id`: solo para Banco / Link_Pago (referencia a `cuentas_config`).
 *  - `monto_bruto`: lo que paga el cliente.
 *  - `porcentaje_comision`: snapshot de la comision al momento de la venta
 *    (independiente de cambios futuros en cuentas_config).
 *  - `monto_neto`: monto_bruto * (1 - comision/100). Es lo que efectivamente
 *    ingresa al banco; se usa para conciliacion.
 */
export interface PagoVentaDetalleInput {
  metodo_pago: 'Efectivo' | 'Banco' | 'Link_Pago' | 'Credito' | 'Otro'
  cuenta_id?: number | null
  monto_bruto: number
  porcentaje_comision?: number
  monto_neto?: number
}

export interface PagoVentaDetalle extends PagoVentaDetalleInput {
  id?: number
  venta_id: number
  porcentaje_comision: number
  monto_neto: number
}

// ==================== CORRELATIVO ====================

export async function getNextCorrelativo(): Promise<string> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const ventas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    const count = ventas.length + 1
    return `FC-${count.toString().padStart(4, '0')}`
  }

  const supabase = createClient()
  if (!supabase) return 'FC-0001'

  try {
    const { count, error } = await supabase
      .from('ventas_encabezado')
      .select('*', { count: 'exact', head: true })

    if (error) return 'FC-0001'
    const nextNum = (count || 0) + 1
    return `FC-${nextNum.toString().padStart(4, '0')}`
  } catch {
    return 'FC-0001'
  }
}

// ==================== VENTAS ====================

export async function getVentas(): Promise<{ data: VentaEncabezado[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    return { data: saved ? JSON.parse(saved) : [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('ventas_encabezado')
      .select(`
        *,
        clientes (nombre),
        almacenes (nombre),
        ventas_detalle (
          productos (
            emprendimientos (nombre)
          )
        )
      `)
      .order('id', { ascending: false })

    if (error) return { data: [], error: error.message }

    const formattedData = (data || []).map(v => {
      const detalles = (v.ventas_detalle as any[]) || []
      const emprendimientosUnicos = [
        ...new Set(
          detalles
            .map(d => (d.productos as any)?.emprendimientos?.nombre)
            .filter(Boolean)
        ),
      ]
      return {
        ...v,
        cliente_nombre: (v.clientes as any)?.nombre || '',
        almacen_nombre: (v.almacenes as any)?.nombre || '',
        emprendimiento_nombre: emprendimientosUnicos.join(' / ') || null,
      }
    })
    
    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo ventas:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getVentaById(id: number): Promise<{ data: VentaEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_encabezado')
    const ventas: VentaEncabezado[] = saved ? JSON.parse(saved) : []
    const venta = ventas.find(v => v.id === id) || null
    return { data: venta, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('ventas_encabezado')
      .select(`
        *,
        clientes (nombre)
      `)
      .eq('id', id)
      .single()

    if (error) return { data: null, error: error.message }
    return { 
      data: { ...data, cliente_nombre: data.clientes?.nombre || '' }, 
      error: null 
    }
  } catch (err) {
    console.error('[Supabase] Error obteniendo venta:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

export async function getDetallesVenta(ventaId: number): Promise<{ data: VentaDetalle[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('ventas_detalle')
    const detalles: VentaDetalle[] = saved ? JSON.parse(saved) : []
    return { data: detalles.filter(d => d.venta_id === ventaId), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('ventas_detalle')
      .select(`
        *,
        productos (nombre, codigo_barras)
      `)
      .eq('venta_id', ventaId)
      .order('id', { ascending: true })

    if (error) return { data: [], error: error.message }
    
    const formattedData = (data || []).map(d => ({
      ...d,
      producto_nombre: d.productos?.nombre || '',
      producto_codigo: d.productos?.codigo_barras || ''
    }))
    
    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo detalles:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export interface VentaDetalleAnalitico {
  fecha_venta: string
  numero_factura: string
  cliente_nombre: string
  producto_nombre: string
  producto_sku: string
  cantidad: number
  precio_unitario: number
  costo_promedio_momento: number
  utilidad_linea: number
  almacen_nombre: string
}

export interface LineaVenta {
  detalle_id: number
  venta_id: number
  producto_id: number
  numero_factura: string
  fecha_venta: string
  cliente_nombre: string
  almacen_nombre: string
  estado_pago: string
  total_venta: number
  valorpago: number
  producto_nombre: string
  codigo_barras: string
  emprendimiento_nombre: string | null
  cantidad: number
  precio_unitario: number
  /** Porcentaje de descuento aplicado a la factura (0 si no hubo descuento) */
  descuento: number
  /** Porcentaje de descuento por línea (0 para registros históricos) */
  descuentodetalle: number
  /** Método de pago agregado de la venta (Efectivo/Banco/Mixto/Credito/Otro) */
  metodo_pago: string
  /** Valor directo del campo comisionbanc en ventas_encabezado (null si columna no existe aún) */
  comisionbanc: number | null
  /** Comisión bancaria efectiva de la venta en %, ya ponderada si es Mixto */
  comision_porcentaje: number
  /** Precio original antes de comisión (lo que el cliente paga) */
  precio_bruto_unitario: number
  /** Precio neto que recibe el negocio tras descontar comisión bancaria */
  precio_neto_unitario: number
}

export async function getDetalleAnalitico(
  fechaInicio?: string,
  fechaFin?: string
): Promise<{ data: VentaDetalleAnalitico[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: [], error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    let query = supabase
      .from('ventas_detalle')
      .select(`
        cantidad,
        precio_unitario,
        costo_promedio_momento,
        utilidad_linea,
        ventas_encabezado (
          fecha_venta,
          numero_factura,
          almacen_id,
          clientes ( nombre ),
          almacenes ( nombre )
        ),
        productos ( nombre, codigo_barras )
      `)
      .order('venta_id', { ascending: false })

    const { data, error } = await query

    if (error) return { data: [], error: error.message }

    const formattedData: VentaDetalleAnalitico[] = (data || [])
      .filter(d => {
        const ve = d.ventas_encabezado as any
        if (!ve) return false
        if (fechaInicio && ve.fecha_venta < fechaInicio) return false
        if (fechaFin && ve.fecha_venta > fechaFin + 'T23:59:59') return false
        return true
      })
      .map(d => {
        const ve = d.ventas_encabezado as any
        return {
          fecha_venta: ve?.fecha_venta || '',
          numero_factura: ve?.numero_factura || '',
          cliente_nombre: ve?.clientes?.nombre || '',
          producto_nombre: (d.productos as any)?.nombre || '',
          producto_sku: (d.productos as any)?.codigo_barras || '',
          cantidad: d.cantidad || 0,
          precio_unitario: d.precio_unitario || 0,
          costo_promedio_momento: d.costo_promedio_momento || 0,
          utilidad_linea: d.utilidad_linea || 0,
          almacen_nombre: ve?.almacenes?.nombre || '',
        }
      })

    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo detalle analitico:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getLineasVenta(): Promise<{ data: LineaVenta[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { data: [], error: null }
  }
  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }
  try {
    // 1. Fetch detail lines with sale header and product joins
    const { data, error } = await supabase
      .from('ventas_detalle')
      .select(`
        id,
        venta_id,
        producto_id,
        cantidad,
        precio_unitario,
        descuentodetalle,
        ventas_encabezado (
          numero_factura,
          fecha_venta,
          estado_pago,
          total_venta,
          valorpago,
          comisionbanc,
          descuento,
          metodo_pago,
          clientes ( nombre ),
          almacenes ( nombre )
        ),
        productos (
          nombre,
          codigo_barras,
          emprendimientos ( nombre )
        )
      `)
      .order('venta_id', { ascending: false })

    if (error) return { data: [], error: error.message }

    const rows = data ?? []

    // 2. Batch-fetch payment info (method + commission) per venta_id
    type PagoInfo = { metodo: string; comision_pct: number }
    const pagosMap = new Map<number, PagoInfo>()

    const ventaIds = [...new Set(rows.map((d: any) => d.venta_id as number))]
    if (ventaIds.length > 0) {
      const { data: pagosData } = await supabase
        .from('ventas_pagos_detalle')
        .select('venta_id, metodo_pago, monto_bruto, monto_neto')
        .in('venta_id', ventaIds)

      if (pagosData && pagosData.length > 0) {
        type PRow = { venta_id: number; metodo_pago: string; monto_bruto: number | null; monto_neto: number | null }
        const grouped = new Map<number, PRow[]>()
        for (const p of pagosData as PRow[]) {
          const arr = grouped.get(p.venta_id) ?? []
          arr.push(p)
          grouped.set(p.venta_id, arr)
        }
        for (const [ventaId, pagos] of grouped) {
          const sumBruto = pagos.reduce((s, p) => s + (Number(p.monto_bruto) || 0), 0)
          const sumNeto  = pagos.reduce((s, p) => s + (Number(p.monto_neto)  || 0), 0)
          const comision_pct = sumBruto > 0 ? ((sumBruto - sumNeto) / sumBruto) * 100 : 0
          const methods = new Set(pagos.map(p => p.metodo_pago))
          const tieneEfectivo = methods.has('Efectivo')
          const tieneBanco    = methods.has('Banco') || methods.has('Link_Pago')
          const tieneCredito  = methods.has('Credito')
          let metodo: string
          if (tieneEfectivo && tieneBanco) metodo = 'Mixto'
          else if (tieneEfectivo) metodo = 'Efectivo'
          else if (tieneBanco)    metodo = 'Banco'
          else if (tieneCredito)  metodo = 'Credito'
          else metodo = 'Otro'
          pagosMap.set(ventaId, { metodo, comision_pct: +comision_pct.toFixed(4) })
        }
      }
    }

    const formattedData: LineaVenta[] = rows.map((d: any) => {
      const ve  = d.ventas_encabezado
      const p   = d.productos
      const pago = pagosMap.get(d.venta_id) ?? { metodo: 'Efectivo', comision_pct: 0 }
      const precio_unitario = d.precio_unitario ?? 0

      // comisionbanc > 0 → venta nueva: precio_unitario ya es NETO en la DB
      // comisionbanc = 0/null → venta antigua: precio_unitario es BRUTO en la DB
      const comisionbanc: number | null = ve?.comisionbanc ?? null
      const esVentaNueva = comisionbanc != null && comisionbanc > 0

      let comision_porcentaje: number
      let precio_bruto_unitario: number
      let precio_neto_unitario: number

      if (esVentaNueva) {
        // precio_unitario en DB es neto; recuperamos bruto para mostrar
        comision_porcentaje = comisionbanc
        precio_neto_unitario = precio_unitario
        precio_bruto_unitario = comisionbanc < 100
          ? +(precio_unitario / (1 - comisionbanc / 100)).toFixed(4)
          : precio_unitario
      } else {
        // precio_unitario en DB es bruto; calculamos neto desde ventas_pagos_detalle
        comision_porcentaje = pago.comision_pct
        precio_bruto_unitario = precio_unitario
        precio_neto_unitario = +(precio_unitario * (1 - pago.comision_pct / 100)).toFixed(4)
      }

      return {
        detalle_id: d.id,
        venta_id: d.venta_id,
        producto_id: d.producto_id,
        numero_factura: ve?.numero_factura ?? '',
        fecha_venta: ve?.fecha_venta ?? '',
        cliente_nombre: ve?.clientes?.nombre ?? '',
        almacen_nombre: ve?.almacenes?.nombre ?? '',
        estado_pago: ve?.estado_pago ?? '',
        total_venta: ve?.total_venta ?? 0,
        valorpago: ve?.valorpago ?? 0,
        producto_nombre: p?.nombre ?? '',
        codigo_barras: p?.codigo_barras ?? '',
        emprendimiento_nombre: p?.emprendimientos?.nombre ?? null,
        cantidad: d.cantidad ?? 0,
        precio_unitario,
        descuento: Number(ve?.descuento ?? 0),
        descuentodetalle: Number(d.descuentodetalle ?? 0),
        metodo_pago: ve?.metodo_pago ?? pago.metodo,
        comisionbanc: comisionbanc,
        comision_porcentaje,
        precio_bruto_unitario,
        precio_neto_unitario,
      }
    })

    return { data: formattedData, error: null }
  } catch (err) {
    console.error('[getLineasVenta] Exception:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

interface CrearVentaData {
  encabezado: Omit<VentaEncabezado, 'id' | 'cliente_nombre' | 'fecha_venta'>
  detalles: Omit<VentaDetalle, 'id' | 'venta_id' | 'producto_nombre' | 'producto_codigo'>[]
  almacen_id: number
  localizacion_id: number
  /**
   * Desglose multi-metodo del pago. Si viene presente, sustituye al campo
   * `valorpago` del encabezado: la suma de `monto_bruto` se usa como
   * `valorpago` y se deriva `estado_pago`. Si esta vacio o ausente, la
   * venta se considera 100% credito (Pendiente).
   */
  pagos_detalle?: PagoVentaDetalleInput[]
}

export async function crearVenta(
  data: CrearVentaData
): Promise<{ data: VentaEncabezado | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedEnc = localStorage.getItem('ventas_encabezado')
    const savedDet = localStorage.getItem('ventas_detalle')
    const savedProd = localStorage.getItem('productos')
    const savedTrans = localStorage.getItem('transacciones_inventario')
    
    const ventas: VentaEncabezado[] = savedEnc ? JSON.parse(savedEnc) : []
    const allDetalles: VentaDetalle[] = savedDet ? JSON.parse(savedDet) : []
    const productos: { id: number; stock_total: number }[] = savedProd ? JSON.parse(savedProd) : []
    const transacciones: { id?: number; producto_id: number; tipo: string; cantidad: number; costo_unitario: number; referencia_tipo: string; referencia_id: number; created_at: string }[] = savedTrans ? JSON.parse(savedTrans) : []
    
    const newVenta: VentaEncabezado = { 
      ...data.encabezado, 
      id: Date.now(),
      fecha_venta: getHondurasNowISO()
    }
    ventas.push(newVenta)
    localStorage.setItem('ventas_encabezado', JSON.stringify(ventas))
    
    const newDetalles = data.detalles.map((d, idx) => ({
      ...d,
      id: Date.now() + idx + 1,
      venta_id: newVenta.id!
    }))
    allDetalles.push(...newDetalles)
    localStorage.setItem('ventas_detalle', JSON.stringify(allDetalles))
    
    // Update products stock
    for (const detalle of data.detalles) {
      const prodIdx = productos.findIndex(p => p.id === detalle.producto_id)
      if (prodIdx >= 0) {
        productos[prodIdx] = {
          ...productos[prodIdx],
          stock_total: (productos[prodIdx].stock_total || 0) - detalle.cantidad
        }
      }
      
      // Create inventory transaction
      transacciones.push({
        id: Date.now() + Math.random(),
        producto_id: detalle.producto_id,
        almacen_id: data.almacen_id,
        localizacion_id: data.localizacion_id,
        tipo_movimiento: 'Salida Venta',
        cantidad: -detalle.cantidad,
        costo_o_precio_unitario: detalle.costo_promedio_momento,
        referencia_id: newVenta.id!,
        fecha: getHondurasNowISO()
      })
    }
    
    localStorage.setItem('productos', JSON.stringify(productos))
    localStorage.setItem('transacciones_inventario', JSON.stringify(transacciones))
    
    return { data: newVenta, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[v0][crearVenta] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // ----- DESGLOSE DE PAGO -----------------------------------------------
    // La fuente de verdad para `valorpago` y `estado_pago` es la suma del
    // NETO de cada linea (monto_bruto * (1 - porcentaje_comision/100)),
    // porque `total_venta` ahora se persiste tambien en NETO desde el UI
    // (lo que efectivamente recibe el comercio tras comisiones bancarias).
    // Asi `valorpago` y `total_venta` viven en la misma escala y el
    // estado_pago refleja la cobertura real.
    //
    // Si una linea no tiene comision (Efectivo u "Otro"), monto_neto =
    // monto_bruto y el resultado es identico al comportamiento legacy.
    // Si no se envio desglose, mantenemos los campos del encabezado
    // (compatibilidad con flujos antiguos / pendientes).
    // ----- VENTA A CREDITO (valor 0) ---------------------------------------
    // Defensa en profundidad: aunque la UI ya manda todo en 0, el service
    // fuerza la invariante para que una venta a credito NUNCA registre
    // dinero: sin pagos, sin CxC (total 0 => estado Pagado), precios 0.
    // El descuento de stock + kardex (paso 3) corre igual que siempre.
    const esCredito = data.encabezado.es_credito === true

    const pagosDetalle = esCredito ? [] : (data.pagos_detalle ?? [])
    const totalVenta = esCredito ? 0 : Number(data.encabezado.total_venta || 0)
    let valorpagoCalculado = esCredito ? 0 : Number(data.encabezado.valorpago ?? 0)
    let estadoPagoCalculado: VentaEncabezado['estado_pago'] = esCredito
      ? 'Pagado'
      : data.encabezado.estado_pago

    if (pagosDetalle.length > 0) {
      valorpagoCalculado = pagosDetalle.reduce((acc, p) => {
        const bruto = Number(p.monto_bruto || 0)
        const comision = Number(p.porcentaje_comision ?? 0)
        const neto =
          p.monto_neto != null
            ? Number(p.monto_neto)
            : bruto * (1 - comision / 100)
        return acc + neto
      }, 0)
      valorpagoCalculado = +valorpagoCalculado.toFixed(2)
      if (valorpagoCalculado <= 0) {
        estadoPagoCalculado = 'Pendiente'
      } else if (valorpagoCalculado >= totalVenta - 0.005) {
        estadoPagoCalculado = 'Pagado'
      } else {
        estadoPagoCalculado = 'Parcial'
      }

      // Validacion de seguridad: si hay Efectivo > 0, exige sesion de caja
      // abierta antes de tocar `ventas_encabezado` (no creamos venta sin
      // poder registrar el ingreso de efectivo).
      const efectivoMonto = pagosDetalle
        .filter((p) => p.metodo_pago === 'Efectivo')
        .reduce((acc, p) => acc + Number(p.monto_bruto || 0), 0)
      if (efectivoMonto > 0) {
        const { data: sesion, error: sesErr } = await getSesionAbierta()
        // Si la migracion 011 no existe, no bloqueamos: registramos solo el
        // encabezado (modo degradado). Si existe pero no hay sesion abierta,
        // SI bloqueamos para cumplir la regla de negocio.
        if (!sesErr && !sesion?.id) {
          return {
            data: null,
            error: 'Debe abrir caja antes de realizar ventas en efectivo',
          }
        }
      }
    }

    // ----- COMISIÓN BANCARIA EFECTIVA -----------------------------------------
    // Se calcula como promedio ponderado de los % de comisión de cada método de
    // pago, usando monto_bruto como peso.
    // Resultado: 0 si la venta es 100% efectivo/crédito, > 0 si hay banco.
    let comisionEfectivaPct = 0
    if (pagosDetalle.length > 0) {
      const sumBrutoTotal = pagosDetalle.reduce((s, p) => s + Number(p.monto_bruto || 0), 0)
      const sumComisionLps = pagosDetalle.reduce((s, p) => {
        const pct = Number(p.porcentaje_comision ?? 0)
        return s + Number(p.monto_bruto || 0) * pct / 100
      }, 0)
      comisionEfectivaPct = sumBrutoTotal > 0
        ? +((sumComisionLps / sumBrutoTotal) * 100).toFixed(4)
        : 0
    }

    // Método de pago denormalizado: un valor resumen por venta para historial y cierre
    let metodoPagoEncabezado: string | null = null
    if (esCredito) {
      metodoPagoEncabezado = 'Credito'
    } else if (pagosDetalle.length > 0) {
      const metodosUnicos = [...new Set(pagosDetalle.map(p => p.metodo_pago))]
      metodoPagoEncabezado = metodosUnicos.length === 1 ? metodosUnicos[0] : 'Mixto'
    }

    // 1. Insert venta encabezado with almacen_id (sello completo: empresa + usuario)
    const encabezadoConAlmacen = {
      ...data.encabezado,
      fecha_venta: getHondurasNowISO(),
      valorpago: valorpagoCalculado,
      estado_pago: estadoPagoCalculado,
      almacen_id: data.almacen_id,
      comisionbanc: comisionEfectivaPct,
      metodo_pago: metodoPagoEncabezado,
      es_credito: esCredito,
      es_envio: data.encabezado.es_envio === true,
      valor_flete: data.encabezado.es_envio === true ? Number(data.encabezado.valor_flete || 0) : 0,
      ...(esCredito ? { subtotal: 0, total_venta: 0, impuesto_total: 0 } : {}),
      ...stamp
    }

    let { data: ventaData, error: ventaError } = await supabase
      .from('ventas_encabezado')
      .insert(encabezadoConAlmacen)
      .select()
      .single()

    // Fallback: si alguna columna nueva aun no existe en la DB,
    // reintentamos sin esos campos para no bloquear la creacion de ventas.
    if (ventaError && /valorpago|comisionbanc|metodo_pago|descuentodetalle|es_credito|es_envio|valor_flete/i.test(ventaError.message || '')) {
      console.warn('[crearVenta] Columna nueva no existe. Reintentando sin campos nuevos.')
      const { valorpago: _v, comisionbanc: _c, metodo_pago: _m, es_credito: _ec, es_envio: _ee, valor_flete: _vf, ...sinCamposNuevos } = encabezadoConAlmacen as
        { valorpago?: number; comisionbanc?: number; metodo_pago?: string | null; es_credito?: boolean; es_envio?: boolean; valor_flete?: number } & Record<string, unknown>
      const retry = await supabase
        .from('ventas_encabezado')
        .insert(sinCamposNuevos)
        .select()
        .single()
      ventaData = retry.data
      ventaError = retry.error
    }

    if (ventaError) return { data: null, error: ventaError.message }

    // 2. Insert detalles — precio_unitario se guarda como precio NETO cuando
    //    hay comisión bancaria (bruto × (1 - comisionEfectivaPct/100)).
    //    utilidad_linea se recalcula sobre el precio neto para reflejar el
    //    ingreso real del negocio.
    const detallesConVenta = data.detalles.map(d => {
      // Venta a credito: precio y utilidad en 0 (neutral en estado de
      // resultados); el costo del producto queda solo en el kardex.
      if (esCredito) {
        return {
          ...d,
          venta_id: ventaData.id,
          razon_social_id: stamp.razon_social_id,
          precio_unitario: 0,
          descuentodetalle: 0,
          utilidad_linea: 0,
        }
      }
      const descPct = d.descuentodetalle ?? 0
      if (comisionEfectivaPct > 0) {
        const precioNeto = +(d.precio_unitario * (1 - comisionEfectivaPct / 100)).toFixed(4)
        const utilidadNeta = +((precioNeto * (1 - descPct / 100) - d.costo_promedio_momento) * d.cantidad).toFixed(4)
        return {
          ...d,
          venta_id: ventaData.id,
          razon_social_id: stamp.razon_social_id,
          precio_unitario: precioNeto,
          descuentodetalle: descPct,
          utilidad_linea: utilidadNeta,
        }
      }
      return {
        ...d,
        venta_id: ventaData.id,
        razon_social_id: stamp.razon_social_id,
        descuentodetalle: descPct,
      }
    })

    let { error: detallesError } = await supabase
      .from('ventas_detalle')
      .insert(detallesConVenta)

    // Fallback: si `comentario` aun no existe (migracion 025 sin aplicar),
    // reintentamos sin ese campo para no bloquear la venta.
    if (detallesError && /comentario/i.test(detallesError.message || '')) {
      console.warn('[crearVenta] Columna comentario no existe. Reintentando sin ella.')
      const sinComentario = detallesConVenta.map(({ comentario: _c, ...rest }) => rest)
      const retry = await supabase.from('ventas_detalle').insert(sinComentario)
      detallesError = retry.error
    }

    if (detallesError) {
      await supabase.from('ventas_encabezado').delete().eq('id', ventaData.id)
      return { data: null, error: detallesError.message }
    }

    // 3. Update stock and create inventory transactions (sello completo)
    for (const detalle of data.detalles) {
      // Get current stock
      const { data: prodData, error: prodReadError } = await supabase
        .from('productos')
        .select('stock_total')
        .eq('id', detalle.producto_id)
        .single()

      if (prodReadError) continue

      const nuevoStock = (prodData?.stock_total || 0) - detalle.cantidad

      // Update product stock
      await supabase
        .from('productos')
        .update({
          stock_total: nuevoStock,
          updated_at: getHondurasNowISO()
        })
        .eq('id', detalle.producto_id)

      // Create inventory transaction (negative quantity = stock decrease)
      await supabase
        .from('transacciones_inventario')
        .insert({
          producto_id: detalle.producto_id,
          almacen_id: data.almacen_id,
          localizacion_id: data.localizacion_id,
          tipo_movimiento: 'Salida Venta',
          cantidad: -detalle.cantidad,
          costo_o_precio_unitario: detalle.costo_promedio_momento,
          referencia_id: ventaData.id,
          ...stamp
          // fecha defaults to now() in database
        })
    }

    // ----- 4. Persistir desglose de pagos (auditoria) ----------------------
    // Si la tabla `ventas_pagos_detalle` aun no existe (migracion 011
    // pendiente), degradamos sin error: la venta queda creada con
    // `valorpago`/`estado_pago` correctos. NOTA: el registro en caja chica
    // y cuentas bancarias se hace en un bloque SEPARADO (ver 5)
    // para que NO dependa del exito de este insert.
    if (pagosDetalle.length > 0) {
      const pagosRows = pagosDetalle.map((p) => {
        const comision = Number(p.porcentaje_comision ?? 0)
        const neto =
          p.monto_neto != null
            ? Number(p.monto_neto)
            : +(Number(p.monto_bruto) * (1 - comision / 100)).toFixed(2)
        return {
          venta_id: ventaData.id,
          metodo_pago: p.metodo_pago,
          cuenta_id: p.cuenta_id ?? null,
          monto_bruto: Number(p.monto_bruto),
          porcentaje_comision: comision,
          monto_neto: neto,
          razon_social_id: stamp.razon_social_id,
          usuario: stamp.usuario,
        }
      })

      const { error: pagosErr } = await supabase
        .from('ventas_pagos_detalle')
        .insert(pagosRows)

      if (pagosErr) {
        if (/does not exist|ventas_pagos_detalle/i.test(pagosErr.message)) {
          console.warn(
            '[crearVenta] Tabla `ventas_pagos_detalle` no existe. ' +
              'Aplica scripts/011-tesoreria-caja-chica.sql para activar el desglose multi-metodo.'
          )
          // Modo degradado: continua a registrar caja/cuentas igualmente.
        } else {
          // Error real: rollback minimo del encabezado para no dejar venta huerfana.
          await supabase.from('ventas_detalle').delete().eq('venta_id', ventaData.id)
          await supabase.from('ventas_encabezado').delete().eq('id', ventaData.id)
          return { data: null, error: pagosErr.message }
        }
      }
    }

    // ----- 5. Registrar movimientos de tesoreria (SIEMPRE) -----------------
    // Estos movimientos representan flujo de dinero real (caja chica,
    // cuentas bancarias) y deben registrarse independientemente de si el
    // desglose en `ventas_pagos_detalle` se persistio o no. Errores aqui
    // generan warning pero NO revierten la venta: la venta ya esta valida
    // y el usuario podra reconciliar manualmente si algo falla.
    if (pagosDetalle.length > 0) {
      for (const p of pagosDetalle) {
        const monto = Number(p.monto_bruto)
        if (monto <= 0) continue

        if (p.metodo_pago === 'Efectivo') {
          // Concepto: usamos el ID de la venta (clave estable y unica).
          // Si existe numero de factura, lo agregamos como contexto.
          const facturaTag = data.encabezado.numero_factura
            ? ` (${data.encabezado.numero_factura})`
            : ''
          const r = await registrarMovimientoCaja({
            tipo: 'Ingreso_Venta',
            monto,
            concepto: `Venta #${ventaData.id}${facturaTag}`,
            ref_tipo: 'venta',
            ref_id: ventaData.id,
          })
          if (r.error) {
            console.warn(
              '[crearVenta] No se pudo registrar Ingreso_Venta en caja:',
              r.error
            )
          }
        } else if (
          (p.metodo_pago === 'Banco' || p.metodo_pago === 'Link_Pago') &&
          p.cuenta_id
        ) {
          const comision = Number(p.porcentaje_comision ?? 0)
          const neto =
            p.monto_neto != null
              ? Number(p.monto_neto)
              : +(monto * (1 - comision / 100)).toFixed(2)
          const r = await registrarMovimientoCuenta({
            cuenta_id: p.cuenta_id,
            tipo: 'Ingreso',
            monto: neto,
            monto_bruto: monto,
            concepto: `Venta ${data.encabezado.numero_factura} (neto)`,
            ref_tipo: 'venta',
            ref_id: ventaData.id,
          })
          if (r.error) {
            console.warn(
              '[crearVenta] No se pudo registrar movimiento bancario:',
              r.error
            )
          }
        }
      }
    }

    return { data: ventaData, error: null }
  } catch (err) {
    console.error('[Supabase] Error creando venta:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== PAGOS ====================

export async function getPagosVenta(ventaId: number): Promise<{ data: PagoVenta[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('pagos_ventas')
    const pagos: PagoVenta[] = saved ? JSON.parse(saved) : []
    return { data: pagos.filter(p => p.venta_id === ventaId), error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('pagos_ventas')
      .select('*')
      .eq('venta_id', ventaId)
      .order('fecha_pago', { ascending: true })

    if (error) return { data: [], error: error.message }
    return { data: data || [], error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo pagos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function registrarPago(
  pago: Omit<PagoVenta, 'id' | 'fecha_pago'>
): Promise<{ data: PagoVenta | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedPagos = localStorage.getItem('pagos_ventas')
    const savedVentas = localStorage.getItem('ventas_encabezado')
    
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    
    const newPago: PagoVenta = { 
      ...pago, 
      id: Date.now(),
      fecha_pago: getHondurasNowISO()
    }
    pagos.push(newPago)
    localStorage.setItem('pagos_ventas', JSON.stringify(pagos))
    
    // Update venta estado_pago + valorpago (contador acumulado)
    const ventaIdx = ventas.findIndex(v => v.id === pago.venta_id)
    if (ventaIdx >= 0) {
      const venta = ventas[ventaIdx]
      const nuevoValorpago = (venta.valorpago || 0) + pago.monto

      ventas[ventaIdx] = {
        ...venta,
        valorpago: nuevoValorpago,
        estado_pago: nuevoValorpago >= venta.total_venta ? 'Pagado' : 'Parcial'
      }
      localStorage.setItem('ventas_encabezado', JSON.stringify(ventas))
    }
    
    return { data: newPago, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      console.log('[v0][registrarPago] Stamp invalido:', stamp)
      return { data: null, error: SESION_INVALIDA_ERROR }
    }

    // Insert payment (sello completo: empresa + usuario que registra el pago)
    const { data: pagoData, error: pagoError } = await supabase
      .from('pagos_ventas')
      .insert({ ...pago, ...stamp })
      .select()
      .single()

    if (pagoError) return { data: null, error: pagoError.message }

    // Intentamos leer `valorpago` (contador acumulado). Si la columna aun
    // no existe en la DB (migracion 009 pendiente), caemos al calculo
    // historico desde `pagos_ventas`.
    const { data: ventaData, error: ventaError } = await supabase
      .from('ventas_encabezado')
      .select('total_venta, valorpago')
      .eq('id', pago.venta_id)
      .single()

    const totalVenta = ventaData?.total_venta || 0
    const tieneColumnaValorpago =
      !ventaError && ventaData && 'valorpago' in ventaData

    let nuevoValorpago: number
    if (tieneColumnaValorpago) {
      nuevoValorpago = (ventaData.valorpago || 0) + pago.monto
    } else {
      // Fallback: sumar todos los pagos de pagos_ventas (incluye el
      // recien insertado) para derivar el acumulado.
      const { data: pagosData } = await supabase
        .from('pagos_ventas')
        .select('monto')
        .eq('venta_id', pago.venta_id)
      nuevoValorpago = (pagosData || []).reduce((acc, p) => acc + p.monto, 0)
    }

    const nuevoEstado: 'Pendiente' | 'Parcial' | 'Pagado' =
      nuevoValorpago >= totalVenta ? 'Pagado' : 'Parcial'

    // Si la columna existe incluimos valorpago en el update; de lo contrario
    // solo actualizamos estado_pago (comportamiento previo).
    const updatePayload: Record<string, unknown> = { estado_pago: nuevoEstado }
    if (tieneColumnaValorpago) updatePayload.valorpago = nuevoValorpago

    await supabase
      .from('ventas_encabezado')
      .update(updatePayload)
      .eq('id', pago.venta_id)

    return { data: pagoData, error: null }
  } catch (err) {
    console.error('[Supabase] Error registrando pago:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== CUENTAS POR COBRAR ====================

export interface CuentaPorCobrar {
  id: number
  numero_factura: string
  cliente_id: number
  cliente_nombre: string
  fecha_venta: string
  total_venta: number
  total_abonado: number
  saldo_pendiente: number
  estado_pago: 'Pendiente' | 'Parcial'
  porcentaje_pagado: number
}

export async function getCuentasPorCobrar(): Promise<{ data: CuentaPorCobrar[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedVentas = localStorage.getItem('ventas_encabezado')
    const savedPagos = localStorage.getItem('pagos_ventas')
    
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    
    // Usamos `valorpago` como total pagado acumulado. Mantiene compat
    // hacia atras: si una venta vieja no tiene valorpago, caemos a la
    // suma de pagos_ventas para no perder cartera historica.
    const cuentas = ventas
      .filter(v => v.estado_pago !== 'Pagado')
      .map(v => {
        const totalAbonado = (v.valorpago ?? null) !== null
          ? (v.valorpago || 0)
          : pagos
              .filter(p => p.venta_id === v.id)
              .reduce((acc, p) => acc + p.monto, 0)
        const saldoPendiente = v.total_venta - totalAbonado

        return {
          id: v.id!,
          numero_factura: v.numero_factura,
          cliente_id: v.cliente_id,
          cliente_nombre: v.cliente_nombre || '',
          fecha_venta: v.fecha_venta || '',
          total_venta: v.total_venta,
          total_abonado: totalAbonado,
          saldo_pendiente: saldoPendiente,
          estado_pago: v.estado_pago as 'Pendiente' | 'Parcial',
          porcentaje_pagado: v.total_venta > 0 ? (totalAbonado / v.total_venta) * 100 : 0
        }
      })
    
    return { data: cuentas, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    // Get ventas that are not fully paid. Ahora traemos `valorpago`
    // directamente; la suma desde `pagos_ventas` queda como respaldo
    // historico para ventas antiguas que aun no tienen valorpago.
    const baseSelect = `
      id,
      numero_factura,
      cliente_id,
      fecha_venta,
      total_venta,
      estado_pago,
      clientes (nombre)
    `
    let { data: ventasData, error: ventasError } = await supabase
      .from('ventas_encabezado')
      .select(baseSelect.replace('estado_pago', 'valorpago,\n      estado_pago'))
      .neq('estado_pago', 'Pagado')
      .order('fecha_venta', { ascending: false })

    // Fallback: columna `valorpago` aun no existe en la DB.
    if (ventasError && /valorpago/i.test(ventasError.message || '')) {
      const retry = await supabase
        .from('ventas_encabezado')
        .select(baseSelect)
        .neq('estado_pago', 'Pagado')
        .order('fecha_venta', { ascending: false })
      ventasData = retry.data as typeof ventasData
      ventasError = retry.error
    }

    if (ventasError) return { data: [], error: ventasError.message }

    // Para ventas SIN valorpago (historicas), calculamos total abonado
    // desde pagos_ventas para no perder cartera. Las nuevas usan valorpago.
    const ventasSinValorpago = (ventasData || []).filter(
      v => v.valorpago === null || v.valorpago === undefined
    )

    let pagosMap: Record<number, number> = {}
    if (ventasSinValorpago.length > 0) {
      const { data: pagosData } = await supabase
        .from('pagos_ventas')
        .select('venta_id, monto')
        .in('venta_id', ventasSinValorpago.map(v => v.id))

      pagosMap = (pagosData || []).reduce((acc, p) => {
        acc[p.venta_id] = (acc[p.venta_id] || 0) + p.monto
        return acc
      }, {} as Record<number, number>)
    }

    const cuentas: CuentaPorCobrar[] = (ventasData || []).map(v => {
      const totalAbonado =
        v.valorpago !== null && v.valorpago !== undefined
          ? v.valorpago
          : pagosMap[v.id] || 0
      const saldoPendiente = v.total_venta - totalAbonado

      return {
        id: v.id,
        numero_factura: v.numero_factura,
        cliente_id: v.cliente_id,
        cliente_nombre: v.clientes?.nombre || '',
        fecha_venta: v.fecha_venta,
        total_venta: v.total_venta,
        total_abonado: totalAbonado,
        saldo_pendiente: saldoPendiente,
        estado_pago: v.estado_pago as 'Pendiente' | 'Parcial',
        porcentaje_pagado: v.total_venta > 0 ? (totalAbonado / v.total_venta) * 100 : 0
      }
    })

    return { data: cuentas, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo cuentas por cobrar:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

export async function getAllPagos(): Promise<{ data: (PagoVenta & { numero_factura?: string; cliente_nombre?: string })[]; error: string | null }> {
  if (!isSupabaseConfigured()) {
    const savedPagos = localStorage.getItem('pagos_ventas')
    const savedVentas = localStorage.getItem('ventas_encabezado')
    
    const pagos: PagoVenta[] = savedPagos ? JSON.parse(savedPagos) : []
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    
    const pagosConInfo = pagos.map(p => {
      const venta = ventas.find(v => v.id === p.venta_id)
      return {
        ...p,
        numero_factura: venta?.numero_factura || '',
        cliente_nombre: venta?.cliente_nombre || ''
      }
    }).sort((a, b) => new Date(b.fecha_pago || '').getTime() - new Date(a.fecha_pago || '').getTime())
    
    return { data: pagosConInfo, error: null }
  }

  const supabase = createClient()
  if (!supabase) return { data: [], error: 'Cliente no disponible' }

  try {
    const { data, error } = await supabase
      .from('pagos_ventas')
      .select(`
        *,
        ventas_encabezado (
          numero_factura,
          clientes (nombre)
        )
      `)
      .order('fecha_pago', { ascending: false })

    if (error) return { data: [], error: error.message }

    const pagosConInfo = (data || []).map(p => ({
      ...p,
      numero_factura: p.ventas_encabezado?.numero_factura || '',
      cliente_nombre: p.ventas_encabezado?.clientes?.nombre || ''
    }))

    return { data: pagosConInfo, error: null }
  } catch (err) {
    console.error('[Supabase] Error obteniendo pagos:', err)
    return { data: [], error: 'Error de conexion' }
  }
}

// ==================== DASHBOARD ANALYTICS ====================

export interface VentasDashboardData {
  // Main KPIs
  ventasTotales: number
  gananciaBruta: number
  ticketPromedio: number
  cantidadFacturas: number
  unidadesVendidas: number
  margenPromedio: number
  
  // Trends
  ventasMesActual: number
  ventasMesAnterior: number
  crecimientoMensual: number
  
  // By time
  ventasPorMes: { mes: string; mesNum: number; anio: number; ventas: number; ganancia: number; facturas: number }[]
  ventasPorAnio: { anio: number; ventas: number; ganancia: number; facturas: number }[]
  
  // Rankings
  topClientes: { id: number; nombre: string; ventas: number; facturas: number; ganancia: number }[]
  topProductos: { id: number; nombre: string; codigo: string; cantidad: number; ventas: number; ganancia: number }[]
  topAlmacenes: { id: number; nombre: string; ventas: number; facturas: number }[]
  
  // Additional metrics
  clientesActivos: number
  productosVendidos: number
}

export async function getVentasDashboard(anio?: number, mes?: number): Promise<{ data: VentasDashboardData | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    // LocalStorage implementation
    const savedVentas = localStorage.getItem('ventas_encabezado')
    const savedDetalles = localStorage.getItem('ventas_detalle')
    const savedClientes = localStorage.getItem('clientes')
    const savedProductos = localStorage.getItem('productos')
    const savedTransacciones = localStorage.getItem('transacciones_inventario')
    const savedAlmacenes = localStorage.getItem('almacenes')
    
    const ventas: VentaEncabezado[] = savedVentas ? JSON.parse(savedVentas) : []
    const detalles: VentaDetalle[] = savedDetalles ? JSON.parse(savedDetalles) : []
    const clientes = savedClientes ? JSON.parse(savedClientes) : []
    const productos = savedProductos ? JSON.parse(savedProductos) : []
    const transacciones = savedTransacciones ? JSON.parse(savedTransacciones) : []
    const almacenes = savedAlmacenes ? JSON.parse(savedAlmacenes) : []
    
    // Filter by year/month if specified
    let ventasFiltradas = ventas
    if (anio) {
      ventasFiltradas = ventasFiltradas.filter(v => {
        const fecha = new Date(v.fecha_venta || '')
        return fecha.getFullYear() === anio
      })
    }
    if (mes) {
      ventasFiltradas = ventasFiltradas.filter(v => {
        const fecha = new Date(v.fecha_venta || '')
        return fecha.getMonth() + 1 === mes
      })
    }
    
    const ventaIds = ventasFiltradas.map(v => v.id)
    const detallesFiltrados = detalles.filter(d => ventaIds.includes(d.venta_id))
    
    // Calculate KPIs
    const ventasTotales = ventasFiltradas.reduce((acc, v) => acc + v.total_venta, 0)
    const gananciaBruta = detallesFiltrados.reduce((acc, d) => acc + d.utilidad_linea, 0)
    const cantidadFacturas = ventasFiltradas.length
    const ticketPromedio = cantidadFacturas > 0 ? ventasTotales / cantidadFacturas : 0
    const unidadesVendidas = detallesFiltrados.reduce((acc, d) => acc + d.cantidad, 0)
    const margenPromedio = ventasTotales > 0 ? (gananciaBruta / ventasTotales) * 100 : 0
    
    // Monthly trend
    const now = new Date()
    const mesActual = now.getMonth() + 1
    const anioActual = now.getFullYear()
    const ventasMesActual = ventas
      .filter(v => {
        const f = new Date(v.fecha_venta || '')
        return f.getMonth() + 1 === mesActual && f.getFullYear() === anioActual
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const mesAnterior = mesActual === 1 ? 12 : mesActual - 1
    const anioMesAnterior = mesActual === 1 ? anioActual - 1 : anioActual
    const ventasMesAnterior = ventas
      .filter(v => {
        const f = new Date(v.fecha_venta || '')
        return f.getMonth() + 1 === mesAnterior && f.getFullYear() === anioMesAnterior
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const crecimientoMensual = ventasMesAnterior > 0 
      ? ((ventasMesActual - ventasMesAnterior) / ventasMesAnterior) * 100 
      : 0
    
    // Group by month
    const ventasPorMesMap: Record<string, { ventas: number; ganancia: number; facturas: number; mesNum: number; anio: number }> = {}
    ventasFiltradas.forEach(v => {
      const f = new Date(v.fecha_venta || '')
      const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      if (!ventasPorMesMap[key]) {
        ventasPorMesMap[key] = { ventas: 0, ganancia: 0, facturas: 0, mesNum: f.getMonth() + 1, anio: f.getFullYear() }
      }
      ventasPorMesMap[key].ventas += v.total_venta
      ventasPorMesMap[key].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      ventasPorMesMap[key].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const ventasPorMes = Object.entries(ventasPorMesMap)
      .map(([key, val]) => ({
        mes: meses[val.mesNum - 1],
        mesNum: val.mesNum,
        anio: val.anio,
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio * 100 + a.mesNum - (b.anio * 100 + b.mesNum))
    
    // Group by year
    const ventasPorAnioMap: Record<number, { ventas: number; ganancia: number; facturas: number }> = {}
    ventas.forEach(v => {
      const f = new Date(v.fecha_venta || '')
      const yr = f.getFullYear()
      if (!ventasPorAnioMap[yr]) {
        ventasPorAnioMap[yr] = { ventas: 0, ganancia: 0, facturas: 0 }
      }
      ventasPorAnioMap[yr].ventas += v.total_venta
      ventasPorAnioMap[yr].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      ventasPorAnioMap[yr].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const ventasPorAnio = Object.entries(ventasPorAnioMap)
      .map(([yr, val]) => ({
        anio: parseInt(yr),
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio - b.anio)
    
    // Top Clientes
    const clienteMap: Record<number, { ventas: number; facturas: number; ganancia: number }> = {}
    ventasFiltradas.forEach(v => {
      if (!clienteMap[v.cliente_id]) {
        clienteMap[v.cliente_id] = { ventas: 0, facturas: 0, ganancia: 0 }
      }
      clienteMap[v.cliente_id].ventas += v.total_venta
      clienteMap[v.cliente_id].facturas += 1
      
      const dets = detalles.filter(d => d.venta_id === v.id)
      clienteMap[v.cliente_id].ganancia += dets.reduce((acc, d) => acc + d.utilidad_linea, 0)
    })
    
    const topClientes = Object.entries(clienteMap)
      .map(([id, val]) => {
        const cliente = clientes.find((c: { id: number }) => c.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: cliente?.nombre || 'Desconocido',
          ventas: val.ventas,
          facturas: val.facturas,
          ganancia: val.ganancia
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Productos
    const productoMap: Record<number, { cantidad: number; ventas: number; ganancia: number }> = {}
    detallesFiltrados.forEach(d => {
      if (!productoMap[d.producto_id]) {
        productoMap[d.producto_id] = { cantidad: 0, ventas: 0, ganancia: 0 }
      }
      productoMap[d.producto_id].cantidad += d.cantidad
      productoMap[d.producto_id].ventas += d.cantidad * d.precio_unitario
      productoMap[d.producto_id].ganancia += d.utilidad_linea
    })
    
    const topProductos = Object.entries(productoMap)
      .map(([id, val]) => {
        const producto = productos.find((p: { id: number }) => p.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: producto?.nombre || 'Desconocido',
          codigo: producto?.codigo_barras || '',
          cantidad: val.cantidad,
          ventas: val.ventas,
          ganancia: val.ganancia
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Almacenes
    const almacenVentas: Record<number, { ventas: number; facturas: Set<number> }> = {}
    const ventaSalidas = transacciones.filter((t: { tipo_movimiento: string }) => t.tipo_movimiento === 'Salida Venta')
    ventaSalidas.forEach((t: { almacen_id: number; referencia_id: number; costo_o_precio_unitario: number; cantidad: number }) => {
      if (ventaIds.includes(t.referencia_id)) {
        if (!almacenVentas[t.almacen_id]) {
          almacenVentas[t.almacen_id] = { ventas: 0, facturas: new Set() }
        }
        almacenVentas[t.almacen_id].ventas += t.costo_o_precio_unitario * Math.abs(t.cantidad)
        almacenVentas[t.almacen_id].facturas.add(t.referencia_id)
      }
    })
    
    const topAlmacenes = Object.entries(almacenVentas)
      .map(([id, val]) => {
        const almacen = almacenes.find((a: { id: number }) => a.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: almacen?.nombre || `Almacen ${id}`,
          ventas: val.ventas,
          facturas: val.facturas.size
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 5)
    
    return {
      data: {
        ventasTotales,
        gananciaBruta,
        ticketPromedio,
        cantidadFacturas,
        unidadesVendidas,
        margenPromedio,
        ventasMesActual,
        ventasMesAnterior,
        crecimientoMensual,
        ventasPorMes,
        ventasPorAnio,
        topClientes,
        topProductos,
        topAlmacenes,
        clientesActivos: Object.keys(clienteMap).length,
        productosVendidos: Object.keys(productoMap).length
      },
      error: null
    }
  }

  const supabase = createClient()
  if (!supabase) return { data: null, error: 'Cliente no disponible' }

  // Aislamiento multi-tenant: el dashboard SOLO debe ver ventas de la razon
  // social del usuario logueado. Si la sesion no tiene tenant valido, dejamos
  // pasar la consulta - el resultado natural sera vacio porque ningun row
  // matchea null.
  const stamp = await getTenantStamp(supabase)
  const tenantId = stamp.razon_social_id

  try {
    // Build date filter
    let ventasQuery = supabase
      .from('ventas_encabezado')
      .select(`
        id,
        numero_factura,
        cliente_id,
        fecha_venta,
        total_venta,
        clientes (nombre)
      `)

    if (tenantId != null) ventasQuery = ventasQuery.eq('razon_social_id', tenantId)

    if (anio) {
      const startDate = new Date(anio, mes ? mes - 1 : 0, 1).toISOString()
      const endDate = mes 
        ? new Date(anio, mes, 0, 23, 59, 59).toISOString()
        : new Date(anio, 11, 31, 23, 59, 59).toISOString()
      ventasQuery = ventasQuery.gte('fecha_venta', startDate).lte('fecha_venta', endDate)
    }
    
    const { data: ventasData, error: ventasError } = await ventasQuery
    if (ventasError) return { data: null, error: ventasError.message }
    
    const ventaIds = (ventasData || []).map(v => v.id)
    
    // Get detalles
    let detallesData: VentaDetalle[] = []
    if (ventaIds.length > 0) {
      const { data: dets } = await supabase
        .from('ventas_detalle')
        .select('*, productos(nombre, codigo_barras)')
        .in('venta_id', ventaIds)
      detallesData = dets || []
    }
    
    // Get transacciones for almacen data
    let transaccionesData: { almacen_id: number; referencia_id: number; cantidad: number; costo_o_precio_unitario: number }[] = []
    if (ventaIds.length > 0) {
      const { data: trans } = await supabase
        .from('transacciones_inventario')
        .select('almacen_id, referencia_id, cantidad, costo_o_precio_unitario')
        .eq('tipo_movimiento', 'Salida Venta')
        .in('referencia_id', ventaIds)
      transaccionesData = trans || []
    }
    
    // Get almacenes
    const { data: almacenesData } = await supabase.from('almacenes').select('id, nombre')
    
    // Calculate KPIs
    const ventasTotales = (ventasData || []).reduce((acc, v) => acc + v.total_venta, 0)
    const gananciaBruta = detallesData.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    const cantidadFacturas = (ventasData || []).length
    const ticketPromedio = cantidadFacturas > 0 ? ventasTotales / cantidadFacturas : 0
    const unidadesVendidas = detallesData.reduce((acc, d) => acc + d.cantidad, 0)
    const margenPromedio = ventasTotales > 0 ? (gananciaBruta / ventasTotales) * 100 : 0
    
    // Monthly trend (get all ventas for comparison)
    const now = new Date()
    const mesActual = now.getMonth() + 1
    const anioActual = now.getFullYear()
    
    let trendQuery = supabase
      .from('ventas_encabezado')
      .select('total_venta, fecha_venta')
    if (tenantId != null) trendQuery = trendQuery.eq('razon_social_id', tenantId)
    const { data: ventasTrendData } = await trendQuery
    
    const ventasMesActual = (ventasTrendData || [])
      .filter(v => {
        const f = new Date(v.fecha_venta)
        return f.getMonth() + 1 === mesActual && f.getFullYear() === anioActual
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const mesAnterior = mesActual === 1 ? 12 : mesActual - 1
    const anioMesAnterior = mesActual === 1 ? anioActual - 1 : anioActual
    const ventasMesAnterior = (ventasTrendData || [])
      .filter(v => {
        const f = new Date(v.fecha_venta)
        return f.getMonth() + 1 === mesAnterior && f.getFullYear() === anioMesAnterior
      })
      .reduce((acc, v) => acc + v.total_venta, 0)
    
    const crecimientoMensual = ventasMesAnterior > 0 
      ? ((ventasMesActual - ventasMesAnterior) / ventasMesAnterior) * 100 
      : 0
    
    // Group by month
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const ventasPorMesMap: Record<string, { ventas: number; ganancia: number; facturas: number; mesNum: number; anio: number }> = {}
    
    ;(ventasData || []).forEach(v => {
      const f = new Date(v.fecha_venta)
      const key = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      if (!ventasPorMesMap[key]) {
        ventasPorMesMap[key] = { ventas: 0, ganancia: 0, facturas: 0, mesNum: f.getMonth() + 1, anio: f.getFullYear() }
      }
      ventasPorMesMap[key].ventas += v.total_venta
      ventasPorMesMap[key].facturas += 1
      
      const dets = detallesData.filter(d => d.venta_id === v.id)
      ventasPorMesMap[key].ganancia += dets.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    })
    
    const ventasPorMes = Object.entries(ventasPorMesMap)
      .map(([, val]) => ({
        mes: meses[val.mesNum - 1],
        mesNum: val.mesNum,
        anio: val.anio,
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio * 100 + a.mesNum - (b.anio * 100 + b.mesNum))
    
    // Group by year.
    // Usamos `ventasTrendData` (todos los encabezados del tenant sin filtro
    // de fecha) para el total de ventas del anio, y cruzamos con los
    // detalles filtrados para obtener la ganancia real por anio.
    // Para los anios cubiertos por el filtro de fecha (`ventasData`),
    // la ganancia proviene de `detallesData` (que ya incluye utilidad_linea).
    // Para los demas anios presentes en ventasTrendData que NO esten en el
    // filtro actual, hacemos una query batch de sus detalles.
    const aniosEnFiltro = new Set((ventasData || []).map(v => {
      return new Date(v.fecha_venta).getFullYear()
    }))

    // IDs de ventas que estan en trendData pero fuera del filtro principal.
    const ventaIdsFiltro = new Set(ventaIds)
    const ventasTrendFuera = (ventasTrendData || []).filter(v => {
      const id = (v as { id?: number }).id
      return id != null && !ventaIdsFiltro.has(id)
    })
    const idsFuera = ventasTrendFuera
      .map(v => (v as { id?: number }).id)
      .filter((id): id is number => id != null)

    let detsFueraData: { venta_id: number; utilidad_linea: number | null }[] = []
    if (idsFuera.length > 0) {
      const { data: df } = await supabase
        .from('ventas_detalle')
        .select('venta_id, utilidad_linea')
        .in('venta_id', idsFuera)
      detsFueraData = df || []
    }

    // Mapa de ganancia por venta_id (union de detallesData + detsFueraData).
    const gananciaPorVenta: Record<number, number> = {}
    for (const d of detallesData) {
      gananciaPorVenta[d.venta_id] = (gananciaPorVenta[d.venta_id] || 0) + (d.utilidad_linea || 0)
    }
    for (const d of detsFueraData) {
      gananciaPorVenta[d.venta_id] = (gananciaPorVenta[d.venta_id] || 0) + (d.utilidad_linea || 0)
    }

    // Ahora iteramos ventasTrendData completo para tener todos los anios.
    // ventasTrendData solo tiene total_venta + fecha_venta, necesitamos id.
    // Re-hacemos la query trend incluyendo `id`.
    let trendConIdQuery = supabase
      .from('ventas_encabezado')
      .select('id, total_venta, fecha_venta')
    if (tenantId != null) trendConIdQuery = trendConIdQuery.eq('razon_social_id', tenantId)
    const { data: trendConId } = await trendConIdQuery

    const ventasPorAnioMap: Record<number, { ventas: number; ganancia: number; facturas: number }> = {}
    ;(trendConId || []).forEach(v => {
      const f = new Date(v.fecha_venta)
      const yr = f.getFullYear()
      if (!ventasPorAnioMap[yr]) {
        ventasPorAnioMap[yr] = { ventas: 0, ganancia: 0, facturas: 0 }
      }
      ventasPorAnioMap[yr].ventas += v.total_venta
      ventasPorAnioMap[yr].facturas += 1
      ventasPorAnioMap[yr].ganancia += gananciaPorVenta[v.id] || 0
    })
    
    const ventasPorAnio = Object.entries(ventasPorAnioMap)
      .map(([yr, val]) => ({
        anio: parseInt(yr),
        ventas: val.ventas,
        ganancia: val.ganancia,
        facturas: val.facturas
      }))
      .sort((a, b) => a.anio - b.anio)
    
    // Top Clientes
    const clienteMap: Record<number, { nombre: string; ventas: number; facturas: number; ganancia: number }> = {}
    ;(ventasData || []).forEach(v => {
      if (!clienteMap[v.cliente_id]) {
        clienteMap[v.cliente_id] = { nombre: v.clientes?.nombre || 'Desconocido', ventas: 0, facturas: 0, ganancia: 0 }
      }
      clienteMap[v.cliente_id].ventas += v.total_venta
      clienteMap[v.cliente_id].facturas += 1
      
      const dets = detallesData.filter(d => d.venta_id === v.id)
      clienteMap[v.cliente_id].ganancia += dets.reduce((acc, d) => acc + (d.utilidad_linea || 0), 0)
    })
    
    const topClientes = Object.entries(clienteMap)
      .map(([id, val]) => ({
        id: parseInt(id),
        nombre: val.nombre,
        ventas: val.ventas,
        facturas: val.facturas,
        ganancia: val.ganancia
      }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Productos
    const productoMap: Record<number, { nombre: string; codigo: string; cantidad: number; ventas: number; ganancia: number }> = {}
    detallesData.forEach(d => {
      if (!productoMap[d.producto_id]) {
        productoMap[d.producto_id] = { 
          nombre: (d as { productos?: { nombre?: string } }).productos?.nombre || 'Desconocido',
          codigo: (d as { productos?: { codigo_barras?: string } }).productos?.codigo_barras || '',
          cantidad: 0, 
          ventas: 0, 
          ganancia: 0 
        }
      }
      productoMap[d.producto_id].cantidad += d.cantidad
      productoMap[d.producto_id].ventas += d.cantidad * d.precio_unitario
      productoMap[d.producto_id].ganancia += d.utilidad_linea || 0
    })
    
    const topProductos = Object.entries(productoMap)
      .map(([id, val]) => ({
        id: parseInt(id),
        nombre: val.nombre,
        codigo: val.codigo,
        cantidad: val.cantidad,
        ventas: val.ventas,
        ganancia: val.ganancia
      }))
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 10)
    
    // Top Almacenes
    const almacenVentas: Record<number, { ventas: number; facturas: Set<number> }> = {}
    transaccionesData.forEach(t => {
      if (!almacenVentas[t.almacen_id]) {
        almacenVentas[t.almacen_id] = { ventas: 0, facturas: new Set() }
      }
      almacenVentas[t.almacen_id].ventas += t.costo_o_precio_unitario * Math.abs(t.cantidad)
      almacenVentas[t.almacen_id].facturas.add(t.referencia_id)
    })
    
    const topAlmacenes = Object.entries(almacenVentas)
      .map(([id, val]) => {
        const almacen = (almacenesData || []).find(a => a.id === parseInt(id))
        return {
          id: parseInt(id),
          nombre: almacen?.nombre || `Almacen ${id}`,
          ventas: val.ventas,
          facturas: val.facturas.size
        }
      })
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 5)
    
    return {
      data: {
        ventasTotales,
        gananciaBruta,
        ticketPromedio,
        cantidadFacturas,
        unidadesVendidas,
        margenPromedio,
        ventasMesActual,
        ventasMesAnterior,
        crecimientoMensual,
        ventasPorMes,
        ventasPorAnio,
        topClientes,
        topProductos,
        topAlmacenes,
        clientesActivos: Object.keys(clienteMap).length,
        productosVendidos: Object.keys(productoMap).length
      },
      error: null
    }
  } catch (err) {
    console.error('[Supabase] Error obteniendo dashboard:', err)
    return { data: null, error: 'Error de conexion' }
  }
}

// ==================== RAZON SOCIAL FOR PDF ====================

export async function getRazonSocialForPdf(): Promise<{
  nombre_empresa: string
  nombre_comercial: string
  documento: string
  direccion: string
  telefono: string
  correo: string
} | null> {
  if (!isSupabaseConfigured()) {
    const saved = localStorage.getItem('razon_social')
    return saved ? JSON.parse(saved) : null
  }

  const supabase = createClient()
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from('razon_social')
      .select('*')
      .order('id', { ascending: true })
      .limit(1)
      .single()

    if (error) {
      console.error('[v0] Error fetching razon_social:', error)
      return null
    }
    return data
  } catch (err) {
    console.error('[v0] Exception fetching razon_social:', err)
    return null
  }
}

/**
 * Elimina una venta y TODOS sus movimientos asociados (detalles, pagos,
 * reversion de inventario, asientos de caja y bancos).
 *
 * La eliminacion se hace en TypeScript (no via RPC SQL) para mantener el
 * control del esquema real: revierte el stock sumando de vuelta la cantidad
 * vendida y borra los movimientos de inventario relacionando
 * `ventas_detalle.venta_id` con `transacciones_inventario.referencia_id`
 * (mas el `producto_id` de cada linea). Tambien revierte la tesoreria
 * (caja chica y cuentas bancarias) por `ref_tipo='venta'` + `ref_id`.
 *
 * Guard multi-empresa: CADA lectura, UPDATE y DELETE se acota por
 * `razon_social_id = sesion`, de modo que una empresa jamas pueda borrar ni
 * alterar datos (ventas, inventario, productos, tesoreria) de otra.
 */
export async function eliminarVentaCompletamente(
  ventaId: number
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      return { error: SESION_INVALIDA_ERROR }
    }

    // ----- 0. Verificar que la venta exista y pertenezca al tenant ---------
    // Guard de aislamiento multi-empresa: solo borramos ventas de la razon
    // social activa, evitando borrados cruzados entre tenants.
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_encabezado')
      .select('id, razon_social_id')
      .eq('id', ventaId)
      .single()

    if (ventaErr || !venta) {
      return { error: 'La venta no existe' }
    }
    if (venta.razon_social_id !== stamp.razon_social_id) {
      return { error: 'La venta no pertenece a la empresa activa' }
    }

    // ----- 1. Revertir inventario por cada linea de la venta ---------------
    // Relacion: ventas_detalle.venta_id  ===  transacciones_inventario.referencia_id
    //           ventas_detalle.producto_id === transacciones_inventario.producto_id
    // Para cada linea: devolvemos la cantidad al stock del producto y luego
    // borramos su movimiento de inventario ('Salida Venta').
    const { data: detalles, error: detErr } = await supabase
      .from('ventas_detalle')
      .select('producto_id, cantidad')
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)

    if (detErr) {
      console.error('[v0][eliminarVentaCompletamente] Error leyendo detalles:', detErr)
      return { error: detErr.message }
    }

    for (const linea of detalles ?? []) {
      // 1a. Devolver el stock al producto (suma de vuelta lo vendido).
      // Filtramos por razon_social_id para no tocar productos de otra empresa.
      const { data: prod } = await supabase
        .from('productos')
        .select('stock_total')
        .eq('id', linea.producto_id)
        .eq('razon_social_id', stamp.razon_social_id)
        .single()

      if (prod) {
        await supabase
          .from('productos')
          .update({
            stock_total: (prod.stock_total || 0) + (linea.cantidad || 0),
            updated_at: getHondurasNowISO(),
          })
          .eq('id', linea.producto_id)
          .eq('razon_social_id', stamp.razon_social_id)
      }

      // 1b. Borrar el movimiento de inventario de esta linea: se ubica por
      // referencia_id (= venta_id) + producto_id + tipo de salida, SIEMPRE
      // acotado a la razon social activa.
      await supabase
        .from('transacciones_inventario')
        .delete()
        .eq('referencia_id', ventaId)
        .eq('producto_id', linea.producto_id)
        .eq('tipo_movimiento', 'Salida Venta')
        .eq('razon_social_id', stamp.razon_social_id)
    }

    // Barrido de seguridad: cualquier movimiento de 'Salida Venta' restante
    // ligado a esta venta (por si quedo alguno fuera del detalle), siempre de
    // la razon social activa.
    await supabase
      .from('transacciones_inventario')
      .delete()
      .eq('referencia_id', ventaId)
      .eq('tipo_movimiento', 'Salida Venta')
      .eq('razon_social_id', stamp.razon_social_id)

    // ----- 2. Revertir movimientos de tesoreria (caja chica y bancos) ------
    // Estos movimientos se identifican por ref_tipo='venta' y ref_id=ventaId.
    // Capturamos las cuentas y sesiones afectadas ANTES de borrar, para
    // recalcular sus saldos despues: al eliminar un movimiento intermedio,
    // el saldo corriente de caja y el saldo_resultante de la cadena quedan
    // desactualizados (contando dinero de la venta borrada).
    const { data: movsCuenta } = await supabase
      .from('cuenta_movimientos')
      .select('cuenta_id')
      .eq('ref_tipo', 'venta')
      .eq('ref_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    const cuentasAfectadas = [...new Set((movsCuenta ?? []).map((m) => m.cuenta_id).filter((x) => x != null))]

    const { data: movsCaja } = await supabase
      .from('caja_chica_movimientos')
      .select('sesion_id')
      .eq('ref_tipo', 'venta')
      .eq('ref_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    const sesionesAfectadas = [...new Set((movsCaja ?? []).map((m) => m.sesion_id).filter((x) => x != null))]

    await supabase
      .from('cuenta_movimientos')
      .delete()
      .eq('ref_tipo', 'venta')
      .eq('ref_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)

    await supabase
      .from('caja_chica_movimientos')
      .delete()
      .eq('ref_tipo', 'venta')
      .eq('ref_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)

    // Recalcular saldos: cuentas bancarias (saldo cacheado + cadena) y
    // sesiones de caja (cadena de saldo_resultante) afectadas.
    for (const cid of cuentasAfectadas) await recomputarSaldosCuenta(cid as number)
    for (const sid of sesionesAfectadas) await recomputarSaldosSesion(sid as number)

    // ----- 3. Borrar desglose de pagos -------------------------------------
    await supabase
      .from('ventas_pagos_detalle')
      .delete()
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    await supabase
      .from('pagos_ventas')
      .delete()
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)

    // ----- 4. Borrar detalle y encabezado ----------------------------------
    const { error: delDetErr } = await supabase
      .from('ventas_detalle')
      .delete()
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    if (delDetErr) {
      console.error('[v0][eliminarVentaCompletamente] Error borrando detalle:', delDetErr)
      return { error: delDetErr.message }
    }

    const { error: delEncErr } = await supabase
      .from('ventas_encabezado')
      .delete()
      .eq('id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)
    if (delEncErr) {
      console.error('[v0][eliminarVentaCompletamente] Error borrando encabezado:', delEncErr)
      return { error: delEncErr.message }
    }

    return { error: null }
  } catch (err) {
    console.error('[v0][eliminarVentaCompletamente] Exception:', err)
    return { error: 'No se pudo eliminar la venta' }
  }
}

export async function eliminarLineaVenta(
  detalleId: number,
  ventaId: number,
  productoId: number,
  cantidad: number
): Promise<{ error: string | null }> {
  const supabase = createClient()
  if (!supabase) return { error: 'Cliente no disponible' }

  try {
    const stamp = await getTenantStamp(supabase)
    if (!isValidStamp(stamp)) {
      return { error: SESION_INVALIDA_ERROR }
    }

    const { data: encabezado, error: encErr } = await supabase
      .from('ventas_encabezado')
      .select('id, razon_social_id, porcentaje_impuesto')
      .eq('id', ventaId)
      .single()

    if (encErr || !encabezado) return { error: 'La venta no existe' }
    if (encabezado.razon_social_id !== stamp.razon_social_id) {
      return { error: 'La venta no pertenece a la empresa activa' }
    }

    // 1. Revert stock for this product
    const { data: prod } = await supabase
      .from('productos')
      .select('stock_total')
      .eq('id', productoId)
      .eq('razon_social_id', stamp.razon_social_id)
      .single()

    if (prod) {
      await supabase
        .from('productos')
        .update({
          stock_total: (prod.stock_total || 0) + (cantidad || 0),
          updated_at: getHondurasNowISO(),
        })
        .eq('id', productoId)
        .eq('razon_social_id', stamp.razon_social_id)
    }

    // 2. Delete inventory transaction for this line
    await supabase
      .from('transacciones_inventario')
      .delete()
      .eq('referencia_id', ventaId)
      .eq('producto_id', productoId)
      .eq('tipo_movimiento', 'Salida Venta')
      .eq('razon_social_id', stamp.razon_social_id)

    // 3. Delete the detail line
    const { error: delErr } = await supabase
      .from('ventas_detalle')
      .delete()
      .eq('id', detalleId)
      .eq('razon_social_id', stamp.razon_social_id)

    if (delErr) return { error: delErr.message }

    // 4. Recalculate header totals from remaining lines
    const { data: restantes } = await supabase
      .from('ventas_detalle')
      .select('cantidad, precio_unitario')
      .eq('venta_id', ventaId)
      .eq('razon_social_id', stamp.razon_social_id)

    if (!restantes || restantes.length === 0) {
      // Se elimino la ultima linea => se borra toda la venta. Revertimos sus
      // movimientos de tesoreria y recalculamos los saldos afectados (misma
      // logica que eliminarVentaCompletamente).
      const { data: movsCuenta } = await supabase
        .from('cuenta_movimientos')
        .select('cuenta_id')
        .eq('ref_tipo', 'venta')
        .eq('ref_id', ventaId)
        .eq('razon_social_id', stamp.razon_social_id)
      const cuentasAfectadas = [...new Set((movsCuenta ?? []).map((m) => m.cuenta_id).filter((x) => x != null))]

      const { data: movsCaja } = await supabase
        .from('caja_chica_movimientos')
        .select('sesion_id')
        .eq('ref_tipo', 'venta')
        .eq('ref_id', ventaId)
        .eq('razon_social_id', stamp.razon_social_id)
      const sesionesAfectadas = [...new Set((movsCaja ?? []).map((m) => m.sesion_id).filter((x) => x != null))]

      await supabase
        .from('cuenta_movimientos')
        .delete()
        .eq('ref_tipo', 'venta')
        .eq('ref_id', ventaId)
        .eq('razon_social_id', stamp.razon_social_id)

      await supabase
        .from('caja_chica_movimientos')
        .delete()
        .eq('ref_tipo', 'venta')
        .eq('ref_id', ventaId)
        .eq('razon_social_id', stamp.razon_social_id)

      for (const cid of cuentasAfectadas) await recomputarSaldosCuenta(cid as number)
      for (const sid of sesionesAfectadas) await recomputarSaldosSesion(sid as number)

      // No lines remain: clean up the sale
      await supabase.from('ventas_pagos_detalle').delete().eq('venta_id', ventaId).eq('razon_social_id', stamp.razon_social_id)
      await supabase.from('pagos_ventas').delete().eq('venta_id', ventaId).eq('razon_social_id', stamp.razon_social_id)
      await supabase.from('ventas_encabezado').delete().eq('id', ventaId).eq('razon_social_id', stamp.razon_social_id)
    } else {
      const subtotalNuevo = restantes.reduce(
        (acc, r) => acc + (r.cantidad ?? 0) * (r.precio_unitario ?? 0), 0
      )
      const pct = encabezado.porcentaje_impuesto ?? 0
      const isvNuevo = subtotalNuevo * (pct / 100)
      const totalNuevo = subtotalNuevo + isvNuevo
      await supabase
        .from('ventas_encabezado')
        .update({
          subtotal: +subtotalNuevo.toFixed(2),
          impuesto_total: +isvNuevo.toFixed(2),
          total_venta: +totalNuevo.toFixed(2),
          updated_at: getHondurasNowISO(),
        })
        .eq('id', ventaId)
        .eq('razon_social_id', stamp.razon_social_id)
    }

    return { error: null }
  } catch (err) {
    console.error('[eliminarLineaVenta] Exception:', err)
    return { error: 'No se pudo eliminar la línea' }
  }
}

// ==================== VENTAS POR EMPRENDIMIENTO ====================

export interface VentaEmprendedor {
  venta_id: number
  fecha_venta: string
  producto_id: number
  producto_nombre: string
  codigo_barras: string
  cantidad: number
  /**
   * Precio unitario directo de ventas_detalle.
   * Para ventas con comisión bancaria (comisionbanc > 0) este valor ya está
   * guardado como precio neto (precio_cliente × (1 - comision/100)).
   * Para ventas sin comisión es el precio bruto del cliente.
   * En ambos casos es el mismo valor que muestra el historial del portal admin.
   */
  precio_unitario: number
  subtotal: number      // cantidad × precio_unitario
  subtotal_neto: number // igual a subtotal — no se aplica factor adicional
  /** Porcentaje de descuento aplicado a la factura (0 si no hubo descuento) */
  descuento: number
  /** Porcentaje de descuento por línea (0 para registros históricos) */
  descuentodetalle: number
  numero_factura: string
  /** Método de pago consolidado: Efectivo | Banco | Link de pago | Crédito | Mixto | "" */
  metodo_pago: string
  /** Estado de pago de la venta: Pendiente | Parcial | Pagado */
  estado_pago: string
  /** Venta a credito (valor 0, migracion 022) */
  es_credito: boolean
  /** La venta fue un envio (migracion 022) */
  es_envio: boolean
  /** Flete del envio; se descuenta en la liquidacion semanal (migracion 022) */
  valor_flete: number
  /** Nota del vendedor sobre esta linea de venta (migracion 025) */
  comentario: string | null
}

function resolverMetodoPago(metodos: string[]): string {
  if (metodos.length === 0) return ""
  const unicos = [...new Set(metodos)]
  if (unicos.length === 1) {
    if (unicos[0] === "Efectivo") return "Efectivo"
    if (unicos[0] === "Banco") return "Banco"
    if (unicos[0] === "Link_Pago") return "Link de pago"
    if (unicos[0] === "Credito") return "Crédito"
    return unicos[0]
  }
  return "Mixto"
}

export async function getVentasByEmprendimiento(
  emprendimientoId: number,
  desde: string,
  hasta: string
): Promise<VentaEmprendedor[]> {
  const supabase = createClient()
  if (!supabase) return []

  try {
    const buildQuery = (conCamposEnvio: boolean, conComentario: boolean) => supabase
      .from('ventas_detalle')
      .select(`
        venta_id,
        cantidad,
        precio_unitario,
        descuentodetalle,${conComentario ? '\n        comentario,' : ''}
        productos!inner(id, nombre, codigo_barras, emprendimiento_id),
        ventas_encabezado!inner(fecha_venta, numero_factura, descuento, metodo_pago, estado_pago${conCamposEnvio ? ', es_credito, es_envio, valor_flete' : ''})
      `)
      .eq('productos.emprendimiento_id', emprendimientoId)
      .gte('ventas_encabezado.fecha_venta', desde)
      .lte('ventas_encabezado.fecha_venta', hasta)
      .order('venta_id', { ascending: false })

    let conCamposEnvio = true
    let conComentario = true
    let { data, error } = await buildQuery(conCamposEnvio, conComentario)

    // Fallback si la migracion 025 (comentario) no esta aplicada
    if (error && /comentario/i.test(error.message || '')) {
      conComentario = false
      const retry = await buildQuery(conCamposEnvio, conComentario)
      data = retry.data
      error = retry.error
    }

    // Fallback si la migracion 022 no esta aplicada
    if (error && /es_credito|es_envio|valor_flete/i.test(error.message || '')) {
      conCamposEnvio = false
      const retry = await buildQuery(conCamposEnvio, conComentario)
      data = retry.data
      error = retry.error
    }

    if (error) {
      console.error('[ventas] Error getVentasByEmprendimiento:', error)
      return []
    }

    return (data ?? []).map((row: any) => {
      const producto = Array.isArray(row.productos) ? row.productos[0] : row.productos
      const encabezado = Array.isArray(row.ventas_encabezado)
        ? row.ventas_encabezado[0]
        : row.ventas_encabezado

      const descuentodetalle = Number(row.descuentodetalle ?? 0)
      const descuentoEfectivo = descuentodetalle > 0
        ? descuentodetalle
        : Number(encabezado?.descuento ?? 0)
      const productoSubtotal = +((row.cantidad ?? 0) * (row.precio_unitario ?? 0) * (1 - descuentoEfectivo / 100)).toFixed(2)
      const raw: string = encabezado?.metodo_pago ?? ''
      const metodo_pago = raw === 'Link_Pago' ? 'Link de pago'
                        : raw === 'Credito'   ? 'Crédito'
                        : raw
      return {
        venta_id: row.venta_id ?? 0,
        fecha_venta: encabezado?.fecha_venta ?? '',
        producto_id: producto?.id ?? 0,
        producto_nombre: producto?.nombre ?? '',
        codigo_barras: producto?.codigo_barras ?? '',
        cantidad: row.cantidad ?? 0,
        precio_unitario: row.precio_unitario ?? 0,
        subtotal: productoSubtotal,
        subtotal_neto: productoSubtotal,
        descuento: Number(encabezado?.descuento ?? 0),
        descuentodetalle,
        numero_factura: encabezado?.numero_factura ?? '',
        metodo_pago,
        estado_pago: encabezado?.estado_pago ?? 'Pendiente',
        es_credito: encabezado?.es_credito === true,
        es_envio: encabezado?.es_envio === true,
        valor_flete: Number(encabezado?.valor_flete ?? 0),
        comentario: row.comentario ?? null,
      }
    }).sort((a, b) => b.fecha_venta.localeCompare(a.fecha_venta))
  } catch (err) {
    console.error('[ventas] Excepcion getVentasByEmprendimiento:', err)
    return []
  }
}
