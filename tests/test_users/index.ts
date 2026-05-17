// Cookies regenerated 2026-05-14 for user 264 (agency 27, ADMIN) — the
// only user that exists in the current local DB. Roles other than ADMIN
// reuse user 264 because this dev DB is a single-user agency; the
// permission-scoped tests in billing.spec.ts will self-skip when they
// can't find a constrained role to exercise.
//
// To regenerate after DB changes:
//   1. Update tests/test_users/gen_coki.ts with the right user ids
//   2. Run:  npx tsx tests/test_users/gen_coki.ts
//   3. Paste the output here, preserving structure.
export const testUsers: Record<string, { cookies: any[]; origins: any[] }> = {
  ADMIN: {
    cookies: [
      {
        name: 'user',
        value:
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MjY0LCJleHBpcmVzIjoiMjAyNy0wNS0xNFQwOToxMjoyMy4zODJaIiwiaWF0IjoxNzc4NzQ5OTQzLCJleHAiOjE4MTAyODU5NDN9.p5A3M4_Vc5IOE5Ohs7crxoKapUDc20OUtnch_tvtPW8',
        domain: 'localhost',
        path: '/',
        expires: 1810285943.382,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
  MNGR: {
    cookies: [
      {
        name: 'user',
        value:
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MjY0LCJleHBpcmVzIjoiMjAyNy0wNS0xNFQwOToxMjoyMy4zODJaIiwiaWF0IjoxNzc4NzQ5OTQzLCJleHAiOjE4MTAyODU5NDN9.p5A3M4_Vc5IOE5Ohs7crxoKapUDc20OUtnch_tvtPW8',
        domain: 'localhost',
        path: '/',
        expires: 1810285943.382,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
  AGNT: {
    cookies: [
      {
        name: 'user',
        value:
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MjY0LCJleHBpcmVzIjoiMjAyNy0wNS0xNFQwOToxMjoyMy4zODJaIiwiaWF0IjoxNzc4NzQ5OTQzLCJleHAiOjE4MTAyODU5NDN9.p5A3M4_Vc5IOE5Ohs7crxoKapUDc20OUtnch_tvtPW8',
        domain: 'localhost',
        path: '/',
        expires: 1810285943.382,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
  OFFICE: {
    cookies: [
      {
        name: 'user',
        value:
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MjY0LCJleHBpcmVzIjoiMjAyNy0wNS0xNFQwOToxMjoyMy4zODJaIiwiaWF0IjoxNzc4NzQ5OTQzLCJleHAiOjE4MTAyODU5NDN9.p5A3M4_Vc5IOE5Ohs7crxoKapUDc20OUtnch_tvtPW8',
        domain: 'localhost',
        path: '/',
        expires: 1810285943.382,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
}
