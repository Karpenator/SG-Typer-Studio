"use strict";

// Manual GitHub Releases updates. The provider is fixed by electron-builder; the renderer only
// asks this controller to check, download, or install and never supplies a download URL.
const createUpdateManager = ({ updater, currentVersion, packaged, notify = () => {} }) => {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;

  let checking = null;
  let downloading = null;
  let available = null;
  let downloaded = null;

  const notesOf = (info) => {
    const notes = info && info.releaseNotes;
    const text = Array.isArray(notes)
      ? notes.map((entry) => entry && entry.note || "").filter(Boolean).join("\n\n")
      : typeof notes === "string" ? notes : "";
    return text.slice(0, 12000);
  };
  const publicState = (status, extra = {}) => ({
    status,
    currentVersion,
    version: available && available.version || currentVersion,
    ...extra,
  });
  const remember = (info) => {
    available = {
      version: info && info.version || "",
      notes: notesOf(info),
      date: info && info.releaseDate || "",
    };
    return available;
  };
  const failure = (error) => publicState("error", {
    message: String(error && error.message || error || "Unknown update error").slice(0, 500),
  });

  updater.on("error", (error) => notify(failure(error)));
  updater.on("download-progress", (progress) => {
    notify(publicState("downloading", {
      percent: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)),
      transferred: Number(progress && progress.transferred) || 0,
      total: Number(progress && progress.total) || 0,
    }));
  });

  const check = async () => {
    if (!packaged) return publicState("development");
    if (downloaded) return publicState("downloaded", { notes: downloaded.notes });
    if (downloading) return publicState("downloading");
    if (checking) return checking;

    checking = (async () => {
      try {
        notify(publicState("checking"));
        const result = await updater.checkForUpdates();
        if (!result || !result.isUpdateAvailable) return publicState("none");
        const update = remember(result.updateInfo);
        return publicState("available", { notes: update.notes, date: update.date });
      } catch (error) {
        return failure(error);
      } finally {
        checking = null;
      }
    })();
    return checking;
  };

  const download = async () => {
    if (!packaged) return publicState("development");
    if (downloaded) return publicState("downloaded", { notes: downloaded.notes });
    if (downloading) return downloading;
    if (!available) return publicState("none");

    downloading = (async () => {
      try {
        notify(publicState("downloading", { percent: 0 }));
        await updater.downloadUpdate();
        downloaded = available;
        notify(publicState("downloaded", { percent: 100 }));
        return publicState("downloaded", { notes: downloaded.notes });
      } catch (error) {
        return failure(error);
      } finally {
        downloading = null;
      }
    })();
    return downloading;
  };

  const install = () => {
    if (!packaged || !downloaded || downloading) return false;
    // Show the NSIS installer and start the new version after installation.
    updater.quitAndInstall(false, true);
    return true;
  };

  return { check, download, install };
};

module.exports = { createUpdateManager };
