import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isOnboarded } from '@/lib/activation/onboarding'
import ActivationExperience from '@/components/activation/ActivationExperience'

/**
 * Dedicated activation route — its own surface (no app chrome). The dashboard is
 * the reward: an onboarded user is sent there; everyone else completes activation
 * here first. Lives outside the (app) group, so the (app) gate can't loop into it.
 */
export default async function ActivatePage() {
  const user = await getUser()
  if (!user) redirect('/auth')
  if (await isOnboarded(user.agencyId)) redirect('/dashboard')
  return <ActivationExperience />
}
