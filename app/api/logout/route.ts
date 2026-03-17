import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET() {
  const cokis = await cookies()
  cokis.delete('user')
  redirect('/auth')
}
