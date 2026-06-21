/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-parse is node-only and must not be webpack-bundled.
    // @huggingface/transformers is intentionally NOT listed: it's loaded via a
    // hidden runtime import in lib/embeddings.ts (local/Render path only) so it
    // never gets traced into the Vercel serverless build.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
};

export default nextConfig;
