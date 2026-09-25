import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/").at(-1) ?? "icon-maker";
const isUserSite = repositoryName.endsWith(".github.io");
const pagesBasePath = isGitHubPages && !isUserSite ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        assetPrefix: pagesBasePath,
        basePath: pagesBasePath,
        images: { unoptimized: true },
        output: "export" as const,
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
