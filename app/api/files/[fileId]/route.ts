import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireUser } from '@/lib/requireUser'
import { getServerT } from '@/lib/i18n/server'
import { contentDisposition } from '@/lib/storage/disposition'
import { logStorageEvent } from '@/lib/storage/events'
import { canReadFile, loadFileForAgency } from '@/lib/storage/fileAccess'
import { isStorageKey } from '@/lib/storage/keys'
import { headObject, presignDownload, StorageNotFoundError } from '@/lib/storage/objects'
import { servingOf } from '@/lib/storage/policy'

/**
 * The only way to read an uploaded file, and what `files.url` points at.
 *
 * Session → tenant → lead/task access → a 60-second redirect to R2. Requires only
 * a live session rather than an active subscription: a lapsed customer keeps access
 * to files they already uploaded, while uploading stays gated.
 *
 * A file in another agency answers exactly like one that does not exist.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
const notFound = () => NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404, headers: NO_STORE })

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401, headers: NO_STORE })
    throw err
  }

  const fileId = Number((await params).fileId)
  if (!Number.isSafeInteger(fileId) || fileId <= 0) return notFound()

  const scope = { agencyId: user.agencyId, userId: user.id, fileId }
  const file = await loadFileForAgency(fileId, user.agencyId as number)
  if (!file) {
    logStorageEvent('download.denied', { ...scope, reason: 'not_in_agency' })
    return notFound()
  }
  if (!(await canReadFile(user, file))) {
    logStorageEvent('download.denied', { ...scope, reason: 'no_access' })
    return notFound()
  }

  // A row from before the move to R2. Its object was never copied, and this is final.
  if (!isStorageKey(file.path)) {
    logStorageEvent('download.legacy_file', scope)
    const t = await getServerT(user)
    return new NextResponse(t('leadTabs.files.uploader.unavailable'), {
      status: 410,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  try {
    await headObject(file.path)
    const download = req.nextUrl.searchParams.get('download') === '1'
    const { contentType, inline } = servingOf(file.type, { download })
    const url = await presignDownload({
      key: file.path,
      contentType,
      contentDisposition: contentDisposition(file.name, inline ? 'inline' : 'attachment'),
    })
    logStorageEvent('download.authorized', { ...scope, mime: contentType })
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE })
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      logStorageEvent('download.missing_object', scope)
      return notFound()
    }
    // The adapter already logged the cause.
    return NextResponse.json({ ok: false, reason: 'storage_unavailable' }, { status: 503, headers: NO_STORE })
  }
}
