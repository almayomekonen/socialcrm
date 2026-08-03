/**
 * `server-only` is a build-time guard: importing it from a Client Component is
 * a bundler error. Under Vitest there is no bundler and the package is not
 * installed, so modules that legitimately declare themselves server-only —
 * connectors, stores — cannot be imported at all.
 *
 * Aliasing it to this empty module lets those modules be tested directly. It
 * removes a compile-time guarantee that only ever applied to the real build,
 * and grants no runtime capability.
 */
export {}
