import { encrypt } from '@/db/auth'
import { daysFromNow } from '@/lib/dates'

const ROLE_IDS = {
  ADMIN: 91,
  MNGR: 54,
  AGNT: 117,
  OFFICE: 159,
}

async function generate() {
  const genUsers = {}

  for (const [role, id] of Object.entries(ROLE_IDS)) {
    const expires = daysFromNow(365)
    const token = await encrypt({ id, expires })

    genUsers[role] = {
      cookies: [
        {
          name: 'user',
          value: token,
          domain: 'localhost',
          path: '/',
          expires: expires.getTime() / 1000,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }
  }

  // Copy the following object into tests/users.ts
  console.log(JSON.stringify(genUsers, null, 2))
}

generate()
