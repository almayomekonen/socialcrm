import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isOnboarded } from '@/lib/activation/onboarding'
import { isMobileRequest } from '@/lib/device'
import ActivationExperience from '@/components/activation/ActivationExperience'

export default async function ActivatePage() {
  const user = await getUser()
  if (!user) redirect('/auth')
  const mobile = await isMobileRequest()
  if (!mobile && (await isOnboarded(user.agencyId))) redirect('/dashboard')
  return <ActivationExperience />
}
