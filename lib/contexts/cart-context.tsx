"use client"

import * as React from "react"

export interface LineaCarrito {
  producto_id: number
  producto_nombre: string
  producto_codigo: string
  cantidad: number
  precio_unitario: number
  costo_promedio: number
  subtotal: number
  utilidad_linea: number
  stock_disponible: number
  descuento: number  // % descuento por línea (0-100)
  /** Nota libre del vendedor sobre esta línea; visible para el emprendedor. */
  comentario?: string
}

export interface CarritoTemporal {
  id: string
  nombre: string
  lineas: LineaCarrito[]
  clienteId: string
  descuentoPct: number
  almacenId: string
  localizacionId: string
  savedAt: Date
}

interface CartContextValue {
  cartesTemporales: CarritoTemporal[]
  agregarCarrito: (carrito: CarritoTemporal) => void
  eliminarCarrito: (id: string) => void
}

const CartContext = React.createContext<CartContextValue>({
  cartesTemporales: [],
  agregarCarrito: () => {},
  eliminarCarrito: () => {},
})

const STORAGE_KEY = "emprendedores_carritos_temporales"

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cartesTemporales, setCartesTemporales] = React.useState<CarritoTemporal[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return []
      const parsed: CarritoTemporal[] = JSON.parse(stored)
      // savedAt se serializa como string ISO; reconvertir a Date
      return parsed.map(c => ({ ...c, savedAt: new Date(c.savedAt) }))
    } catch {
      return []
    }
  })

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartesTemporales))
    } catch {
      // localStorage lleno o no disponible
    }
  }, [cartesTemporales])

  const agregarCarrito = React.useCallback((carrito: CarritoTemporal) => {
    setCartesTemporales(prev => [...prev, carrito])
  }, [])

  const eliminarCarrito = React.useCallback((id: string) => {
    setCartesTemporales(prev => prev.filter(c => c.id !== id))
  }, [])

  return (
    <CartContext.Provider value={{ cartesTemporales, agregarCarrito, eliminarCarrito }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  return React.useContext(CartContext)
}
