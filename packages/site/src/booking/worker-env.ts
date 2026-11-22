// The Worker's env (bindings), in its own module so the bundle imports `cloudflare:workers`
// statically, as @emdash-cms/cloudflare's email plugin does.
export { env } from 'cloudflare:workers';
