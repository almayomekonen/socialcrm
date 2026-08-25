import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET() {
  const cokis = await cookies()
  cokis.delete('user')
  // Same destination as the `logout()` server action: the canonical homepage.
  redirect('/')
}
