import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { runConversationAnalysisWorker } from '@/lib/inbox/intelligence/worker'

export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization')
  if (auth && auth === `Bearer ${secret}`) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.CONVERSATION_WORKER_SECRET
  if (!secret) {
    console.error('[analyze-conversations] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const result = await runConversationAnalysisWorker({
    deps: { revalidate: (tag: string) => revalidateTag(tag, 'default') },
  })
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
