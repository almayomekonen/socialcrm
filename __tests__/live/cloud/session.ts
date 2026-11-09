/** The harness's signed-in user, read by the mocked `next/headers`. No imports, so the mock can load it first. */
export const session: { cookie: string | undefined } = { cookie: undefined }
