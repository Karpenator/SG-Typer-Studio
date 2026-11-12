#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const validRepository = /^[A-Za-z0-9_.-]{1,100}$/;

function repositoryFrom(args) {
  if (args.length === 1) {
    let url;
    try { url = new URL(args[0]); }
    catch { throw new Error("Use OWNER REPOSITORY or a full https://github.com/OWNER/REPOSITORY URL."); }
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2) {
      throw new Error("The repository URL must look like https://github.com/OWNER/REPOSITORY.");
    }
    return { owner: parts[0], repository: parts[1].replace(/\.git$/, "") };
  }
  if (args.length === 2) return { owner: args[0], repository: args[1].replace(/\.git$/, "") };
  throw new Error("Use OWNER REPOSITORY or a full https://github.com/OWNER/REPOSITORY URL.");
}

function configureGitHub({ owner, repository, root = ROOT }) {
  if (!validOwner.test(owner) || !validRepository.test(repository)) {
    throw new Error("Invalid GitHub owner or repository name.");
  }
  const packageFile = path.join(root, "desktop", "package.json");
  const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  pkg.build.publish = [{ provider: "github", owner, repo: repository, releaseType: "release" }];
  fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

  const releases = `https://github.com/${owner}/${repository}/releases`;
  const preloadFile = path.join(root, "desktop", "src", "preload.js");
  const preload = fs.readFileSync(preloadFile, "utf8");
  const releaseSetting = /const releasesUrl = "https:\/\/github\.com\/[^"]+";/;
  if (!releaseSetting.test(preload)) throw new Error("The preload's fixed releasesUrl could not be configured.");
  const configured = preload.replace(releaseSetting, `const releasesUrl = "${releases}";`);
  fs.writeFileSync(preloadFile, configured);

  const newsFile = path.join(root, "web", "whats-new.json");
  const news = JSON.parse(fs.readFileSync(newsFile, "utf8"));
  news.github = `https://api.github.com/repos/${owner}/${repository}/commits?per_page=1`;
  fs.writeFileSync(newsFile, `${JSON.stringify(news, null, 2)}\n`);
  return { owner, repository, releases };
}

function main() {
  try {
    const repository = repositoryFrom(process.argv.slice(2));
    const result = configureGitHub(repository);
    console.log(`GitHub releases: ${result.releases}`);
    console.log("Update downloads and What's New now use this repository.");
    console.log("Discord still needs only the DISCORD_WEBHOOK_URL Actions secret in the new repository.");
  } catch (error) {
    console.error(error.message);
    console.error("Example: npm run configure:github -- https://github.com/OWNER/REPOSITORY");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { configureGitHub, repositoryFrom };
