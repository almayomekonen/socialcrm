import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { Provider } from '@/lib/hooksNEvents'

export default async function layout({ children }) {
  const user = await getUser()

  const handlers = await getPerms(user)

  return <Provider props={{ handlers: handlers.allPermUsers }}>{children}</Provider>
}
