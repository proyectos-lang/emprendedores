import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Prefer service role key (bypasses RLS); fall back to anon key
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'Supabase no configurado' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folderRaw = formData.get('folder')
    // Sanitizar: solo letras/numeros/guiones, para evitar path traversal
    // en el nombre del archivo dentro del bucket.
    const folder = typeof folderRaw === 'string' ? folderRaw.replace(/[^a-zA-Z0-9_-]/g, '') : ''

    if (!file) {
      return NextResponse.json({ error: 'No se recibio ningun archivo' }, { status: 400 })
    }

    const fileExt = file.name.split('.').pop()
    const fileName = folder ? `${folder}/${Date.now()}.${fileExt}` : `${Date.now()}.${fileExt}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from('productos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data } = supabase.storage.from('productos').getPublicUrl(fileName)

    return NextResponse.json({ url: data.publicUrl })
  } catch (err) {
    console.error('[API] Error subiendo imagen:', err)
    return NextResponse.json({ error: 'Error interno al subir imagen' }, { status: 500 })
  }
}
