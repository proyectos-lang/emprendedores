import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Cliente Supabase con SERVICE ROLE KEY.
 * SOLO debe usarse en Server Actions / Route Handlers.
 * NUNCA importar este archivo desde un Client Component.
 *
 * Se crea por-llamada (no singleton) para evitar compartir estado entre
 * requests concurrentes en el mismo proceso serverless.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "[Supabase Admin] Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. " +
        "Agregalas como variables de entorno para habilitar la creacion de usuarios."
    )
    return null
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: { schema: 'emprendedores' },
  })
}

export function isAdminClientConfigured(): boolean {
  return Boolean(supabaseUrl && serviceRoleKey)
}
