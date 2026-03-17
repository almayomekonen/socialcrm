// test.skip(test.info().project.name !== 'ADMIN');

export const testUsers: Record<string, { cookies: any[]; origins: any[] }> = {
  ADMIN: {
    cookies: [
      {
        name: 'user',
        value:
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTEsImV4cGlyZXMiOiIyMDI2LTEyLTEzVDExOjAzOjE3Ljk1N1oiLCJpYXQiOjE3NjU2MjM3OTcsImV4cCI6MTc5NzE1OTc5N30.-rqS41S80B4Fu4LzJ_RQN-ym27MAr6ffcK9cIjhmc7o',
        domain: 'localhost',
        path: '/',
        expires: 1797159797.957,
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
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NTQsImV4cGlyZXMiOiIyMDI2LTEyLTEzVDExOjAzOjE3Ljk1OVoiLCJpYXQiOjE3NjU2MjM3OTcsImV4cCI6MTc5NzE1OTc5N30.NrpTGPUwyw8D6-NPETdfxdjQe2CJZXkmr3SCTb1KCXQ',
        domain: 'localhost',
        path: '/',
        expires: 1797159797.959,
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
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MTE3LCJleHBpcmVzIjoiMjAyNi0xMi0xM1QxMTowMzoxNy45NjBaIiwiaWF0IjoxNzY1NjIzNzk3LCJleHAiOjE3OTcxNTk3OTd9.uUfhXpn9QQ3NfshzIC4XDFmTJfXaPIxt1EhX92Eprzo',
        domain: 'localhost',
        path: '/',
        expires: 1797159797.96,
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
          'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MTU5LCJleHBpcmVzIjoiMjAyNi0xMi0xM1QxMTowMzoxNy45NjBaIiwiaWF0IjoxNzY1NjIzNzk3LCJleHAiOjE3OTcxNTk3OTd9.1AV8E19umFTLzmbPccfpLL_OZw3FSqTZeEFoB9Oh7Y4',
        domain: 'localhost',
        path: '/',
        expires: 1797159797.96,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  },
}
