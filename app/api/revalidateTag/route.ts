// app/api/save-on-exit/route.ts

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { tag } = await request.json()

  return NextResponse.json({ success: true })
}
