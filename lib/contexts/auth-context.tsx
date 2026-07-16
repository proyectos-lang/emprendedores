"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import { findModuloByDBName } from "@/lib/constants/modulos"

export interface AuthUser {
  usuario_id: string
  auth_user_id: string
  razon_social_id: number | null
  nombre: string
  email: string
  rol: string | null
  logo_url: string | null
  razon_social_nombre: string | null
  modulos_permitidos: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ error: string | null }>
  logout: () => Promise<void>
  hasModulo: (nombre: string) => boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(true)

  // Carga el perfil completo desde 'usuarios' (con JOIN a razon_social) + permisos
  const loadProfile = React.useCallback(
    async (authUserId: string, email: string): Promise<AuthUser | null> => {
      const supabase = createClient()
      if (!supabase) return null

      try {
        // 1) Perfil + razon social (JOIN). El id de usuarios coincide con auth.users.id (UUID).
        const { data: perfil, error } = await supabase
          .from("usuarios")
          .select("id, razon_social_id, nombre, rol, activo, razon_social(nombre_empresa, logo_url)")
          .eq("id", authUserId)
          .single()

        if (error) {
          console.error("[v0][DIAGNOSTICO] Error cargando perfil desde 'usuarios':", JSON.stringify(error))
          // Lanzamos para que login() capture el mensaje real y lo muestre en la UI
          throw new Error(`[usuarios query] ${error.message || error.code || JSON.stringify(error)}`)
        }

        if (!perfil) {
          console.log("[v0] No se encontro perfil en 'usuarios' para auth_user_id:", authUserId)
          throw new Error(`[usuarios vacio] No existe row en emprendedores.usuarios con id=${authUserId}`)
        }

        if (perfil.activo === false) {
          console.log("[v0] Usuario inactivo:", email)
          return null
        }

        const razonSocial: any = Array.isArray(perfil.razon_social)
          ? perfil.razon_social[0]
          : perfil.razon_social

        if (!razonSocial) {
          console.log(
            "[v0] Advertencia: perfil existe pero razon_social es null. Revisa que razon_social_id apunte a un registro valido en la tabla razon_social. perfil.razon_social_id =",
            perfil.razon_social_id
          )
        }

        const nombreEmpresa: string | null = razonSocial?.nombre_empresa ?? null

        // 2) Permisos por modulo
        const { data: permisosData, error: permisosError } = await supabase
          .from("permisos_usuarios")
          .select("puede_ver, modulos(nombre)")
          .eq("usuario_id", perfil.id)
          .eq("puede_ver", true)

        if (permisosError) {
          console.log("[v0] Error cargando permisos:", permisosError)
        }

        // Canonizamos cada nombre de permiso al nombre exacto del constants.
        // Asi sidebar y RouteGuard pueden hacer `hasModulo("Valoracion")` aun
        // si la DB guarda "Valoración" (con tilde) o "Dashboard de Ventas"
        // en vez de "Dashboard Ventas". Si un permiso de la DB no matchea
        // ningun constants (modulo desconocido), se conserva tal cual.
        const modulosPermitidos: string[] = (permisosData || [])
          .map((p: any) => p?.modulos?.nombre)
          .filter(Boolean)
          .map((dbName: string) => findModuloByDBName(dbName)?.nombre ?? dbName)

        return {
          usuario_id: perfil.id,
          auth_user_id: authUserId,
          razon_social_id: perfil.razon_social_id ?? null,
          nombre: perfil.nombre,
          email,
          rol: perfil.rol ?? null,
          logo_url: razonSocial?.logo_url ?? null,
          razon_social_nombre: nombreEmpresa,
          modulos_permitidos: modulosPermitidos,
        }
      } catch (err) {
        console.log("[v0] Excepcion cargando perfil:", err)
        return null
      }
    },
    []
  )

  const refreshProfile = React.useCallback(async () => {
    const supabase = createClient()
    if (!supabase) return
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      setUser(null)
      return
    }
    const profile = await loadProfile(authUser.id, authUser.email || "")
    setUser(profile)
  }, [loadProfile])

  // Init: recuperar sesion al montar + listener de cambios
  React.useEffect(() => {
    const supabase = createClient()
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    // Safety timeout: pase lo que pase, no dejamos "Cargando sesion..."
    // colgado mas de 8 segundos. Si algo falla en el medio, caemos a "no
    // autenticado" y el layout redirige a /login.
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.log("[v0] Safety timeout alcanzado; forzando loading=false")
        setLoading(false)
      }
    }, 8000)

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return

        if (session?.user) {
          const profile = await loadProfile(session.user.id, session.user.email || "")
          if (mounted) setUser(profile)
        }
      } catch (err) {
        console.log("[v0] Error restaurando sesion:", err)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return

        if (event === "SIGNED_OUT" || !session?.user) {
          setUser(null)
          setLoading(false)
          return
        }

        // IMPORTANTE: Supabase mantiene un lock interno mientras ejecuta el
        // callback de onAuthStateChange. Hacer queries async con `await` aqui
        // produce un DEADLOCK que cuelga signInWithPassword y el refresh de sesion.
        // La solucion recomendada es diferir las queries con setTimeout(fn, 0)
        // para que se ejecuten DESPUES de que el lock se libere.
        // Ref: https://github.com/supabase/supabase-js/issues/773
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          const authUserId = session.user.id
          const authEmail = session.user.email || ""
          setTimeout(async () => {
            if (!mounted) return
            try {
              const profile = await loadProfile(authUserId, authEmail)
              if (mounted) setUser(profile)
            } catch (err) {
              console.log("[v0] Error en onAuthStateChange loadProfile:", err)
            } finally {
              if (mounted) setLoading(false)
            }
          }, 0)
        }
      }
    )

    return () => {
      mounted = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const login = React.useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const supabase = createClient()
      if (!supabase) {
        return { error: "Supabase no esta configurado. Contacta al administrador." }
      }

      // Helper: envolver una promesa con timeout para evitar que queden colgadas
      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} tardo mas de ${ms}ms`)), ms)
          ),
        ])

      try {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          }),
          15000,
          "signInWithPassword"
        )

        if (error) {
          console.log("[v0] Error signInWithPassword:", error)
          const msg = (error.message || "").toLowerCase()
          if (msg.includes("invalid login") || msg.includes("invalid_credentials")) {
            return { error: "Email o contrasena incorrectos" }
          }
          if (msg.includes("email not confirmed")) {
            return { error: "Tu email aun no ha sido confirmado" }
          }
          return { error: error.message || "No se pudo iniciar sesion" }
        }

        if (!data.user) {
          return { error: "No se pudo iniciar sesion" }
        }

        const profile = await withTimeout(
          loadProfile(data.user.id, data.user.email || ""),
          10000,
          "loadProfile"
        )
        if (!profile) {
          await supabase.auth.signOut()
          return { error: "Tu cuenta no tiene un perfil asociado o esta inactiva." }
        }

        setUser(profile)
        return { error: null }
      } catch (err: any) {
        console.log("[v0] Login exception:", err)
        const raw = String(err?.message || err || "").toLowerCase()

        // Error de red: no se pudo llegar al servidor de Supabase
        if (
          raw.includes("failed to fetch") ||
          raw.includes("networkerror") ||
          raw.includes("error when attempting to fetch resource") ||
          raw.includes("network request failed") ||
          raw.includes("load failed")
        ) {
          return {
            error:
              "No se pudo conectar con el servidor. Verifica tu conexion a internet o si tu proyecto de Supabase esta activo (puede haberse pausado por inactividad).",
          }
        }

        if (raw.includes("timeout")) {
          return {
            error:
              "El servidor tardo demasiado en responder. Revisa tu conexion o si tu proyecto de Supabase esta activo.",
          }
        }

        return { error: err?.message || "Error al iniciar sesion" }
      }
    },
    [loadProfile]
  )

  const logout = React.useCallback(async () => {
    const supabase = createClient()
    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch (err) {
        console.log("[v0] Error en signOut:", err)
      }
    }
    setUser(null)
  }, [])

  const hasModulo = React.useCallback(
    (nombre: string) => {
      if (!user) return false
      if ((user.rol || "").trim().toLowerCase() === "admin") return true
      // Fallback defensivo: si el usuario aun no tiene permisos configurados,
      // le damos acceso por defecto (estado inicial post-onboarding).
      if (!user.modulos_permitidos || user.modulos_permitidos.length === 0) return true
      return user.modulos_permitidos.includes(nombre)
    },
    [user]
  )

  const value = React.useMemo(
    () => ({ user, loading, login, logout, hasModulo, refreshProfile }),
    [user, loading, login, logout, hasModulo, refreshProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return ctx
}
