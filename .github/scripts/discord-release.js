#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const BRAND_COLOR = 0x7c3aed;
const DESCRIPTION_LIMIT = 3800;

function truncate(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function releaseNotes(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(text || "Новая версия SG Typer Studio уже доступна!", DESCRIPTION_LIMIT);
}

function iconUrl(repository, ref = "HEAD") {
  return `https://raw.githubusercontent.com/${repository}/${ref}/SG_Typer_Studio/images/icon.png`;
}

function installerOf(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((asset) => /setup.*\.exe$/i.test(asset.name || ""))
    || assets.find((asset) => /\.exe$/i.test(asset.name || ""));
}

function buildPayload(release, repository, ref = "HEAD") {
  const tag = release.tag_name || "update";
  const title = truncate(release.name || `SG Typer Studio ${tag}`, 256);
  const icon = iconUrl(repository, ref);
  const releaseUrl = release.html_url;
  const installer = installerOf(release);
  const published = Date.parse(release.published_at || "");
  const timestamp = Number.isFinite(published) ? new Date(published) : new Date();
  const links = [`[Открыть релиз](${releaseUrl})`];
  if (installer) links.push(`[Скачать установщик](${installer.browser_download_url})`);

  const buttons = [{
    type: 2,
    style: 5,
    label: "Открыть релиз",
    emoji: { name: "📦" },
    url: releaseUrl,
  }];
  if (installer) {
    buttons.push({
      type: 2,
      style: 5,
      label: "Скачать установщик",
      emoji: { name: "⬇️" },
      url: installer.browser_download_url,
    });
  }

  return {
    username: "SG Typer Studio",
    avatar_url: icon,
    allowed_mentions: { parse: [] },
    embeds: [{
      author: {
        name: "Новое обновление SG Typer Studio",
        icon_url: icon,
      },
      title,
      url: releaseUrl,
      description: releaseNotes(release.body),
      color: BRAND_COLOR,
      thumbnail: { url: icon },
      fields: [
        { name: "🏷️ Версия", value: `\`${truncate(tag, 100)}\``, inline: true },
        { name: "👤 Автор", value: truncate(release.author && release.author.login || "BOT", 100), inline: true },
        { name: "📅 Дата", value: `<t:${Math.floor(timestamp.getTime() / 1000)}:D>`, inline: true },
        { name: "🔗 Ссылки", value: links.join("  •  "), inline: false },
      ],
      footer: { text: "SG Typer Studio  •  Developed by BOT", icon_url: icon },
      timestamp: timestamp.toISOString(),
    }],
    components: [{ type: 1, components: buttons }],
  };
}

async function loadRelease() {
  if (process.env.GITHUB_EVENT_NAME === "release") {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (!event.release) throw new Error("The GitHub event does not contain a release.");
    return event.release;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const tag = String(process.env.RELEASE_TAG || "").trim();
  const endpoint = tag
    ? `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${repository}/releases/latest`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "User-Agent": "SG-Typer-Studio-Discord-Announcer",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub release request failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const webhook = String(process.env.DISCORD_WEBHOOK_URL || "").trim();
  if (!webhook) {
    throw new Error("Add the DISCORD_WEBHOOK_URL repository secret before running this workflow.");
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is not set.");

  const release = await loadRelease();
  if (!release.html_url) throw new Error("The release has no public URL.");
  const payload = buildPayload(release, repository, process.env.GITHUB_SHA || "HEAD");
  const separator = webhook.includes("?") ? "&" : "?";
  const response = await fetch(`${webhook}${separator}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = truncate(await response.text(), 300);
    throw new Error(`Discord webhook failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`Discord announcement published for ${release.tag_name || release.name}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildPayload, installerOf, releaseNotes, truncate };
