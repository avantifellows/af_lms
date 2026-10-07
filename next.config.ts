import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_TEST_MODE ? ".next-test" : ".next",
  // OAuth discovery for the LMS MCP connector. Clients look these up at fixed
  // well-known paths (RFC 8414 / RFC 9728), optionally suffixed with the
  // resource path; the handlers live under /api/mcp/oauth.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/mcp/oauth/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/mcp/oauth/authorization-server" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/mcp/oauth/protected-resource" },
    ];
  },
};

export default nextConfig;
