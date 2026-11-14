import { fileURLToPath } from 'node:url';
export default { poweredByHeader: false, redirects: async () => [{ source: '/whitepaper', destination: '/about', permanent: true }], turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) } };
