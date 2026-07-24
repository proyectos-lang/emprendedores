"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEmprendedorAuth } from "@/lib/contexts/emprendedor-auth-context"
import { logoutAction } from "@/app/login-emprendedor/actions"
import { LayoutDashboard, Package, Boxes, BarChart3, LogOut, KeyRound, Eye, EyeOff, Tag, Banknote, PencilLine } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cambiarPasswordEmprendedor } from "@/app/(emprendedor)/portal/perfil/actions"
import { toast } from "sonner"

const NAV_ITEMS = [
  { href: "/portal", label: "Inicio", icon: LayoutDashboard },
  { href: "/portal/mis-productos", label: "Crear nuevo producto", icon: Package },
  { href: "/portal/editar-productos", label: "Editar productos", icon: PencilLine },
  { href: "/portal/inventario", label: "Restock", icon: Boxes },
  { href: "/portal/ventas", label: "Ventas", icon: BarChart3 },
  { href: "/portal/cambios-precio", label: "Cambios de precio", icon: Tag },
  { href: "/portal/liquidaciones", label: "Liquidaciones", icon: Banknote },
]

function getInitials(name: string) {
  if (!name) return "E"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function EmprendedorSidebar() {
  const { emprendedor } = useEmprendedorAuth()
  const pathname = usePathname()

  const [openPass, setOpenPass] = React.useState(false)
  const [actual, setActual] = React.useState("")
  const [nueva, setNueva] = React.useState("")
  const [confirmar, setConfirmar] = React.useState("")
  const [showActual, setShowActual] = React.useState(false)
  const [showNueva, setShowNueva] = React.useState(false)
  const [showConfirmar, setShowConfirmar] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  function resetForm() {
    setActual(""); setNueva(""); setConfirmar("")
    setShowActual(false); setShowNueva(false); setShowConfirmar(false)
  }

  async function handleCambiarPassword() {
    if (!emprendedor) return
    if (nueva !== confirmar) { toast.error("Las contraseñas nuevas no coinciden"); return }
    setSaving(true)
    try {
      const { error } = await cambiarPasswordEmprendedor(emprendedor.id, actual, nueva)
      if (error) { toast.error(error); return }
      toast.success("Contraseña actualizada correctamente")
      setOpenPass(false)
      resetForm()
    } catch {
      toast.error("Error inesperado al cambiar la contraseña. Intente de nuevo.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <Dialog open={openPass} onOpenChange={(v) => { setOpenPass(v); if (!v) resetForm() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(120,53,15,0.08)" }}>
              <KeyRound className="h-4 w-4" style={{ color: "#78350f" }} />
            </div>
            <DialogTitle className="text-base font-semibold text-stone-800">Cambiar contraseña</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Contraseña actual */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-stone-600">Contraseña actual</Label>
            <div className="relative">
              <Input
                type={showActual ? "text" : "password"}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="••••••••"
                className="pr-9 text-sm"
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowActual((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                {showActual ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Nueva contraseña */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-stone-600">Nueva contraseña</Label>
            <div className="relative">
              <Input
                type={showNueva ? "text" : "password"}
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="pr-9 text-sm"
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowNueva((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                {showNueva ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Confirmar nueva */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-stone-600">Confirmar nueva contraseña</Label>
            <div className="relative">
              <Input
                type={showConfirmar ? "text" : "password"}
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                placeholder="Repite la nueva contraseña"
                className="pr-9 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleCambiarPassword() }}
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowConfirmar((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                {showConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 text-sm" onClick={() => { setOpenPass(false); resetForm() }}>
              Cancelar
            </Button>
            <Button
              className="flex-1 text-sm text-white"
              style={{ background: "#78350f" }}
              onClick={handleCambiarPassword}
              disabled={saving || !actual || !nueva || !confirmar}
            >
              {saving ? "Guardando…" : "Cambiar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <Link href="/portal/mis-productos" className="flex items-center justify-center group">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/WhatsApp%20Image%202026-04-22%20at%208.57.20%20PM-RKsyYHvftfuejI9wKhhcuYBQcQXMWp.jpeg"
            alt="EasyCount"
            className="h-12 w-auto max-w-[160px] object-contain transition-opacity duration-300 group-hover:opacity-80"
          />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-stone-500 uppercase text-xs tracking-wider font-medium">
            {emprendedor?.emprendimientoNombre ?? "Portal Emprendedor"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={label}
                    isActive={href === "/portal" ? pathname === "/portal" : pathname === href || pathname.startsWith(href + "/")}
                  >
                    <Link href={href}>
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white text-sm font-medium shadow-sm shrink-0"
            style={{ backgroundColor: "#abcde0" }}
          >
            {getInitials(emprendedor?.nombre ?? "E")}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium text-stone-700 truncate">{emprendedor?.nombre}</span>
            <span className="text-xs text-stone-500 truncate">{emprendedor?.emprendimientoNombre}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Cambiar contraseña"
              onClick={() => setOpenPass(true)}
            >
              <KeyRound className="h-4 w-4" />
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="icon" title="Cerrar sesión">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
    </>
  )
}
