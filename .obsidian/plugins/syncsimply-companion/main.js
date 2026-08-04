var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SyncSimplyPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/sync-engine.ts
var import_obsidian = require("obsidian");
function hashContent(buf) {
  const bytes = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++)
    s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
var OBSIDIAN_ALLOWED = (path) => path === ".obsidian/appearance.json" || path.startsWith(".obsidian/themes/") || path.startsWith(".obsidian/snippets/");
function isAlwaysExcluded(p) {
  const segs = p.split("/");
  if (segs.some(
    (s) => s === ".trash" || s === ".git" || s === ".syncsimply" || s === "node_modules" || s === ".Spotlight-V100" || s === ".fseventsd" || s === ".TemporaryItems" || s === ".DocumentRevisions-V100" || s === ".makemd" || s === ".smart-env" || s === ".copilot-index"
  ))
    return true;
  const filename = segs[segs.length - 1];
  if (filename === ".DS_Store" || filename === "Thumbs.db" || filename === "desktop.ini")
    return true;
  if (filename.startsWith("~$") || filename.startsWith(".~lock."))
    return true;
  if (filename.endsWith("~"))
    return true;
  if (filename.startsWith(".") && filename.endsWith(".icloud"))
    return true;
  return false;
}
function shouldDescend(folder) {
  if (isAlwaysExcluded(folder))
    return false;
  if (folder !== ".obsidian" && !folder.startsWith(".obsidian/"))
    return true;
  return folder === ".obsidian" || folder === ".obsidian/themes" || folder.startsWith(".obsidian/themes/") || folder === ".obsidian/snippets" || folder.startsWith(".obsidian/snippets/");
}
var isIgnored = (path, ignoredPaths) => ignoredPaths.some((p) => path === p || path.startsWith(p + "/"));
var skip = (path, ignoredPaths = []) => isAlwaysExcluded(path) || path.startsWith(".obsidian/") && !OBSIDIAN_ALLOWED(path) || isIgnored(path, ignoredPaths);
var GH_API = "https://api.github.com";
var GH_RAW = "https://raw.githubusercontent.com";
var IDLE = { pushed: 0, pulled: 0, conflicts: 0 };
var blockedResult = (blocked) => ({ ...IDLE, blocked });
var SyncEngine = class {
  constructor(app, settings, manifest, onManifestChange) {
    this.syncing = false;
    this.ghGet = (path, token) => this.ghFetch("GET", path, token);
    this.ghPost = (path, token, body) => this.ghFetch("POST", path, token, body);
    this.ghPatch = (path, token, body) => this.ghFetch("PATCH", path, token, body);
    this.app = app;
    this.settings = settings;
    this.manifest = manifest;
    this.onManifestChange = onManifestChange;
  }
  updateSettings(s) {
    this.settings = s;
  }
  /**
   * Of `paths`, the ones the app's ignore list currently excludes. Lets the
   * save notice distinguish "nothing to send" from "your edit was deliberately
   * kept on this device", which otherwise both read as "up to date".
   */
  async filterIgnored(paths) {
    var _a;
    if (paths.length === 0)
      return [];
    const config = await this.readConfig();
    const ignoredPaths = (_a = config == null ? void 0 : config.ignoredPaths) != null ? _a : [];
    if (ignoredPaths.length === 0)
      return [];
    return paths.filter((p) => isIgnored(p, ignoredPaths));
  }
  // ---------- Public API -----------------------------------------------------
  async pull() {
    const ctx = await this.context();
    if (!ctx.ok)
      return blockedResult(ctx.reason);
    try {
      const { pulled, conflicts } = await this.doPull(ctx);
      return { pushed: 0, pulled, conflicts: conflicts.length };
    } catch (e) {
      this.notify(`SyncSimply pull failed: ${e.message}`);
      return IDLE;
    }
  }
  async push() {
    const ctx = await this.context();
    if (!ctx.ok)
      return blockedResult(ctx.reason);
    try {
      const pushed = await this.doPush(ctx);
      return { pushed, pulled: 0, conflicts: 0 };
    } catch (e) {
      this.notify(`SyncSimply push failed: ${e.message}`);
      return IDLE;
    }
  }
  async sync() {
    if (this.syncing)
      return IDLE;
    this.syncing = true;
    try {
      const ctx = await this.context();
      if (!ctx.ok)
        return blockedResult(ctx.reason);
      const { pulled, conflicts } = await this.doPull(ctx);
      let pushed = 0;
      if (conflicts.length === 0)
        pushed = await this.doPush(ctx);
      return { pushed, pulled, conflicts: conflicts.length };
    } catch (e) {
      this.notify(`SyncSimply sync failed: ${e.message}`);
      return IDLE;
    } finally {
      this.syncing = false;
    }
  }
  // ---------- Core pull ------------------------------------------------------
  async doPull(ctx) {
    var _a;
    const { config, token } = ctx;
    const { owner, repo, branch } = config;
    const ignoredPaths = (_a = config.ignoredPaths) != null ? _a : [];
    const ref = await this.ghGet(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
    const remoteSha = ref.object.sha;
    if (!this.manifest) {
      this.manifest = await this.bootstrap(config, token, remoteSha);
      this.onManifestChange(this.manifest);
      return { pulled: 0, conflicts: [] };
    }
    if (remoteSha === this.manifest.headSha)
      return { pulled: 0, conflicts: [] };
    const remoteCommit = await this.ghGet(`/repos/${owner}/${repo}/git/commits/${remoteSha}`, token);
    const remoteTree = await this.ghGet(`/repos/${owner}/${repo}/git/trees/${remoteCommit.tree.sha}?recursive=1`, token);
    const remoteBlobs = remoteTree.tree.filter(
      (e) => e.type === "blob" && !!e.path && !skip(e.path, ignoredPaths)
    );
    const remoteChanged = remoteBlobs.filter((e) => {
      var _a2;
      return ((_a2 = this.manifest.files[e.path]) == null ? void 0 : _a2.blobSha) !== e.sha;
    });
    const remotePathSet = new Set(remoteBlobs.map((e) => e.path));
    const remoteDeleted = Object.keys(this.manifest.files).filter(
      (p) => !remotePathSet.has(p) && !skip(p, ignoredPaths)
    );
    const localMod = /* @__PURE__ */ new Set();
    for (const path of await this.vaultFilePaths(ignoredPaths)) {
      const prev = this.manifest.files[path];
      if (!prev)
        continue;
      const content = await this.app.vault.adapter.readBinary(path);
      if (hashContent(content) !== prev.contentHash)
        localMod.add(path);
    }
    const conflicts = [];
    const updatedFiles = { ...this.manifest.files };
    let pulled = 0;
    for (const entry of remoteChanged) {
      if (localMod.has(entry.path)) {
        conflicts.push(entry.path);
        continue;
      }
      const content = await this.downloadRaw(owner, repo, remoteSha, entry.path, token);
      await this.writeVaultFile(entry.path, content);
      updatedFiles[entry.path] = { blobSha: entry.sha, contentHash: hashContent(content) };
      pulled++;
    }
    for (const path of remoteDeleted) {
      if (localMod.has(path))
        continue;
      await this.deleteVaultFile(path);
      delete updatedFiles[path];
      pulled++;
    }
    const existingConflicts = new Set(this.manifest.conflicts);
    const allConflicts = [.../* @__PURE__ */ new Set([...existingConflicts, ...conflicts])];
    this.manifest = { ...this.manifest, headSha: remoteSha, files: updatedFiles, conflicts: allConflicts };
    this.onManifestChange(this.manifest);
    if (conflicts.length > 0)
      this.notifyConflicts(conflicts);
    return { pulled, conflicts: allConflicts };
  }
  // ---------- Core push ------------------------------------------------------
  async doPush(ctx, retried = false) {
    var _a;
    const { config, token } = ctx;
    const { owner, repo, branch } = config;
    const ignoredPaths = (_a = config.ignoredPaths) != null ? _a : [];
    if (!this.manifest)
      return 0;
    const unresolved = new Set(this.manifest.conflicts);
    const changed = [];
    const changedPaths = [];
    const localFilePaths = await this.vaultFilePaths(ignoredPaths);
    for (const path of localFilePaths) {
      if (unresolved.has(path))
        continue;
      const content = await this.app.vault.adapter.readBinary(path);
      const hash = hashContent(content);
      const prev = this.manifest.files[path];
      if (!prev || prev.contentHash !== hash) {
        changed.push({ path, content });
        changedPaths.push(path);
      }
    }
    const localPaths = new Set(localFilePaths);
    const maybeDeleted = Object.keys(this.manifest.files).filter(
      (p) => !localPaths.has(p) && !unresolved.has(p) && !skip(p, ignoredPaths)
    );
    const deleted = [];
    for (const path of maybeDeleted) {
      if (!await this.app.vault.adapter.exists(path))
        deleted.push(path);
    }
    if (changed.length === 0 && deleted.length === 0)
      return 0;
    const liveRef = await this.ghGet(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
    const liveHeadSha = liveRef.object.sha;
    if (liveHeadSha !== this.manifest.headSha && !retried) {
      await this.doPull(ctx);
      return await this.doPush(ctx, true);
    }
    const newBlobs = [];
    for (const { path, content } of changed) {
      const created = await this.ghPost(
        `/repos/${owner}/${repo}/git/blobs`,
        token,
        { content: toBase64(content), encoding: "base64" }
      );
      newBlobs.push({ path, blobSha: created.sha, content });
    }
    const baseCommit = await this.ghGet(`/repos/${owner}/${repo}/git/commits/${liveHeadSha}`, token);
    const newTree = await this.ghPost(
      `/repos/${owner}/${repo}/git/trees`,
      token,
      {
        base_tree: baseCommit.tree.sha,
        tree: [
          ...newBlobs.map(({ path, blobSha }) => ({ path, mode: "100644", type: "blob", sha: blobSha })),
          ...deleted.map((path) => ({ path, mode: "100644", type: "blob", sha: null }))
        ]
      }
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const message = this.buildMessage([...changedPaths, ...deleted]);
    const newCommit = await this.ghPost(
      `/repos/${owner}/${repo}/git/commits`,
      token,
      { message, tree: newTree.sha, parents: [liveHeadSha], author: { name: "SyncSimply", email: "sync@syncsimply.app", date: now } }
    );
    try {
      await this.ghPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, { sha: newCommit.sha, force: false });
    } catch (e) {
      if (!retried && e.message.includes("422")) {
        await this.doPull(ctx);
        return await this.doPush(ctx, true);
      }
      throw e;
    }
    const updatedFiles = { ...this.manifest.files };
    for (const { path, blobSha, content } of newBlobs) {
      updatedFiles[path] = { blobSha, contentHash: hashContent(content) };
    }
    for (const path of deleted)
      delete updatedFiles[path];
    this.manifest = { ...this.manifest, headSha: newCommit.sha, files: updatedFiles };
    this.onManifestChange(this.manifest);
    return changed.length + deleted.length;
  }
  // ---------- Bootstrap (first run) ------------------------------------------
  async bootstrap(config, token, headSha) {
    var _a, _b;
    const { owner, repo } = config;
    const ignoredPaths = (_a = config.ignoredPaths) != null ? _a : [];
    const headCommit = await this.ghGet(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
    const remoteTree = await this.ghGet(`/repos/${owner}/${repo}/git/trees/${headCommit.tree.sha}?recursive=1`, token);
    const remoteMap = new Map(
      remoteTree.tree.filter((e) => e.type === "blob" && !!e.path && !skip(e.path, ignoredPaths)).map((e) => [e.path, e.sha])
    );
    const files = {};
    for (const path of await this.vaultFilePaths(ignoredPaths)) {
      const content = await this.app.vault.adapter.readBinary(path);
      files[path] = { blobSha: (_b = remoteMap.get(path)) != null ? _b : "", contentHash: hashContent(content) };
    }
    return { headSha, files, conflicts: [] };
  }
  // ---------- Vault I/O -------------------------------------------------------
  /**
   * Every syncable file on disk, walked through the vault adapter.
   *
   * Deliberately not vault.getFiles(): that returns Obsidian's *index*, which
   * never lists dotfiles at the vault root (.gitignore, .gitattributes) or
   * anything under .obsidian — including the appearance.json / themes / snippets
   * that skip() explicitly allows. Those files still reached the manifest via
   * pull, so the index's blind spot made them look locally deleted and pushed a
   * deletion for files sitting right there on disk. The adapter sees what the
   * filesystem sees, matching walkLocalDir on the app side.
   *
   * Errors propagate: a failed listing must abort the sync, because an empty
   * result here would read as "the user deleted everything".
   */
  async vaultFilePaths(ignoredPaths = []) {
    const out = [];
    const walk = async (dir) => {
      const { files, folders } = await this.app.vault.adapter.list(dir);
      for (const f of files) {
        if (!skip(f, ignoredPaths))
          out.push(f);
      }
      for (const d of folders) {
        if (shouldDescend(d))
          await walk(d);
      }
    };
    await walk("/");
    return out;
  }
  async writeVaultFile(path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFile) {
      await this.app.vault.modifyBinary(existing, content);
    } else {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir)
        await this.app.vault.adapter.mkdir(dir);
      await this.app.vault.adapter.writeBinary(path, content);
    }
  }
  async deleteVaultFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.vault.trash(file, false);
      return;
    }
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.trashLocal(path);
    }
  }
  // ---------- GitHub API helpers ----------------------------------------------
  async ghFetch(method, path, token, body) {
    var _a, _b;
    const res = await (0, import_obsidian.requestUrl)({
      url: `${GH_API}${path}`,
      method,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Cache-Control": "no-cache",
        ...body ? { "Content-Type": "application/json" } : {}
      },
      body: body ? JSON.stringify(body) : void 0,
      throw: false
    });
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 401 || res.status === 403)
        throw new Error("GitHub authentication failed. Check your token in SyncSimply plugin settings.");
      if (res.status === 422) {
        try {
          const json = res.json;
          if ((_a = json == null ? void 0 : json.message) == null ? void 0 : _a.includes("Secret detected")) {
            throw new Error(
              "GitHub blocked this push: a secret (like a token or password) was detected in one of your notes. Find and remove it from the file, then sync again."
            );
          }
        } catch (e) {
          if (e.message.startsWith("GitHub blocked"))
            throw e;
        }
      }
      throw new Error(`GitHub API ${res.status}: ${((_b = res.text) != null ? _b : "").slice(0, 200)}`);
    }
    return res.json;
  }
  async downloadRaw(owner, repo, ref, path, token) {
    const res = await (0, import_obsidian.requestUrl)({
      url: `${GH_RAW}/${owner}/${repo}/${ref}/${encodeURIComponent(path)}`,
      headers: { Authorization: `token ${token}` },
      throw: false
    });
    if (res.status < 200 || res.status >= 300)
      throw new Error(`Download failed for ${path}: HTTP ${res.status}`);
    return res.arrayBuffer;
  }
  // ---------- Misc ------------------------------------------------------------
  // Returns the reason rather than notifying here, so each caller decides
  // whether it's the right moment to interrupt the user — a save-triggered push
  // says it in its own toast, while a background pull stays quiet.
  async context() {
    const token = this.settings.githubToken;
    if (!token)
      return { ok: false, reason: "no-token" };
    const config = await this.readConfig();
    if (!config)
      return { ok: false, reason: "not-set-up" };
    return { ok: true, config, token };
  }
  async readConfig() {
    try {
      const raw = await this.app.vault.adapter.read(".syncsimply/config.json");
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  buildMessage(paths) {
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    const names = paths.map((p) => {
      var _a;
      return (_a = p.split("/").pop()) != null ? _a : p;
    });
    const fileList = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
    return `vault backup: ${date} ${time} \u2014 ${fileList}`;
  }
  notify(msg) {
    new import_obsidian.Notice(msg, 6e3);
  }
  async notifyConflicts(paths) {
    var _a;
    const count = paths.length;
    const config = await this.readConfig();
    const vaultId = (_a = config == null ? void 0 : config.vaultId) != null ? _a : this.app.vault.getName();
    const n = new import_obsidian.Notice(
      `SyncSimply: ${count} conflict${count !== 1 ? "s" : ""} detected. Open SyncSimply to resolve.`,
      0
    );
    n.noticeEl.addEventListener("click", () => {
      var _a2, _b, _c;
      const url = `syncsimply://conflicts?vaultId=${encodeURIComponent(vaultId)}`;
      (_c = (_b = (_a2 = this.app).openUrl) == null ? void 0 : _b.call(_a2, url)) != null ? _c : window.open(url);
      n.hide();
    });
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  githubToken: "",
  syncInterval: 0,
  syncOnOpen: true,
  syncOnClose: true,
  showSyncNotifications: true,
  syncOnSave: true
};
var SyncSimplySettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Mobile companion for the SyncSimply iOS app. Automatically syncs your vault with GitHub while you write. Clone repos and resolve conflicts in SyncSimply.",
      cls: "setting-item-description"
    });
    new import_obsidian2.Setting(containerEl).setName("GitHub token").setDesc("Personal access token with repo read/write scope. Same token used in SyncSimply.").addText(
      (text) => text.setPlaceholder("ghp_...").setValue(this.plugin.settings.githubToken).onChange(async (value) => {
        this.plugin.settings.githubToken = value.trim();
        await this.plugin.saveSettings();
      }).inputEl.setAttribute("type", "password")
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on open").setDesc("Pull latest changes when Obsidian opens.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnOpen).onChange(async (value) => {
        this.plugin.settings.syncOnOpen = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on close").setDesc("Push local changes when Obsidian goes to the background.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnClose).onChange(async (value) => {
        this.plugin.settings.syncOnClose = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on save").setDesc("Push 3 seconds after you stop writing. On mobile, this is the most responsive sync option \u2014 no waiting for a timer.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
        this.plugin.settings.syncOnSave = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Show sync notifications").setDesc("Show a notification after each sync with a summary of what changed.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showSyncNotifications).onChange(async (value) => {
        this.plugin.settings.showSyncNotifications = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync interval").setDesc("Periodically push and pull on a timer. Not needed if sync on save is on.").addDropdown(
      (drop) => drop.addOption("0", "Disabled").addOption("1", "Every 1 minute").addOption("2", "Every 2 minutes").addOption("5", "Every 5 minutes").setValue(String(this.plugin.settings.syncInterval)).onChange(async (value) => {
        this.plugin.settings.syncInterval = parseInt(value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Sync now").setDesc("Manually trigger a full push and pull.").addButton(
      (btn) => btn.setButtonText("Sync").onClick(async () => {
        btn.setButtonText("Syncing\u2026");
        btn.setDisabled(true);
        const result = await this.plugin.engine.sync();
        btn.setButtonText("Sync");
        btn.setDisabled(false);
        const parts = [];
        if (result.pushed > 0)
          parts.push(`${result.pushed} pushed`);
        if (result.pulled > 0)
          parts.push(`${result.pulled} pulled`);
        if (result.conflicts > 0)
          parts.push(`${result.conflicts} conflict${result.conflicts !== 1 ? "s" : ""} \u2014 open SyncSimply to resolve`);
        const msg = parts.length > 0 ? parts.join(", ") : "Already up to date";
        this.plugin.showNotice(`SyncSimply: ${msg}`);
      })
    );
  }
};

// src/main.ts
var SyncSimplyPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.intervalHandle = null;
    this.saveDebounce = null;
    this.pendingModified = /* @__PURE__ */ new Set();
  }
  async onload() {
    var _a, _b, _c;
    const data = (_a = await this.loadData()) != null ? _a : {};
    this.settings = { ...DEFAULT_SETTINGS, ...(_b = data.settings) != null ? _b : {} };
    this.engine = new SyncEngine(
      this.app,
      this.settings,
      (_c = data.manifest) != null ? _c : null,
      (m) => this.persistManifest(m)
    );
    this.addSettingTab(new SyncSimplySettingTab(this.app, this));
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        const result = await this.engine.sync();
        this.showNotice(this.formatResult(result));
      }
    });
    if (this.settings.syncOnOpen) {
      this.app.workspace.onLayoutReady(async () => {
        const result = await this.engine.pull();
        if (result.blocked)
          this.showNotice(this.blockedMessage(result.blocked));
      });
    }
    this.scheduleInterval();
    this.registerCloseHandler();
    this.registerSaveHandler();
  }
  onunload() {
    if (this.intervalHandle !== null)
      window.clearInterval(this.intervalHandle);
    if (this.saveDebounce !== null)
      window.clearTimeout(this.saveDebounce);
    this.pendingModified.clear();
  }
  scheduleInterval() {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.settings.syncInterval > 0) {
      this.intervalHandle = window.setInterval(async () => {
        const result = await this.engine.sync();
        if (this.settings.showSyncNotifications) {
          this.showNotice(this.formatResult(result));
        }
      }, this.settings.syncInterval * 60 * 1e3);
    }
  }
  registerCloseHandler() {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden" && this.settings.syncOnClose) {
        this.engine.push();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    this.register(() => document.removeEventListener("visibilitychange", handleVisibility));
  }
  registerSaveHandler() {
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.settings.syncOnSave)
          return;
        this.pendingModified.add(file.path);
        if (this.saveDebounce !== null)
          window.clearTimeout(this.saveDebounce);
        this.saveDebounce = window.setTimeout(async () => {
          this.saveDebounce = null;
          const modified = [...this.pendingModified];
          this.pendingModified.clear();
          const untracked = await this.engine.filterIgnored(modified);
          const result = await this.engine.push();
          if (this.settings.showSyncNotifications) {
            this.showNotice(this.formatSaveResult(result, untracked));
          }
        }, 3e3);
      })
    );
  }
  formatSaveResult(result, untracked) {
    var _a;
    if (result.blocked)
      return this.blockedMessage(result.blocked);
    const parts = [];
    if (result.pushed > 0)
      parts.push(`${result.pushed} pushed`);
    if (untracked.length > 0) {
      const name = ((_a = untracked[0].split("/").pop()) != null ? _a : untracked[0]).replace(/\.md$/, "");
      parts.push(
        untracked.length === 1 ? `${name} saved on this device only \u2014 not tracked` : `${untracked.length} files saved on this device only \u2014 not tracked`
      );
    }
    return parts.length > 0 ? `SyncSimply: ${parts.join(" \xB7 ")}` : "SyncSimply: up to date";
  }
  showNotice(msg) {
    new import_obsidian3.Notice(msg, 4e3);
  }
  // "Up to date" must only ever mean the engine ran and found nothing. When it
  // couldn't run, say why — otherwise an unconfigured plugin looks like a
  // working one for as long as the user keeps typing.
  blockedMessage(reason) {
    return reason === "no-token" ? "SyncSimply: not syncing \u2014 add your GitHub token in plugin settings" : "SyncSimply: not syncing \u2014 this vault isn't set up. Add it in the SyncSimply app first";
  }
  formatResult(result) {
    if (result.blocked)
      return this.blockedMessage(result.blocked);
    const parts = [];
    if (result.pushed > 0)
      parts.push(`${result.pushed} pushed`);
    if (result.pulled > 0)
      parts.push(`${result.pulled} pulled`);
    if (result.conflicts > 0)
      parts.push(`${result.conflicts} conflict${result.conflicts !== 1 ? "s" : ""}`);
    return `SyncSimply: ${parts.length > 0 ? parts.join(", ") : "up to date"}`;
  }
  async saveSettings() {
    this.engine.updateSettings(this.settings);
    this.scheduleInterval();
    await this.persistData();
  }
  async persistManifest(manifest) {
    await this.persistData(manifest);
  }
  async persistData(manifest) {
    var _a, _b;
    const current = (_a = await this.loadData()) != null ? _a : {};
    await this.saveData({
      settings: this.settings,
      manifest: manifest !== void 0 ? manifest : (_b = current.manifest) != null ? _b : null
    });
  }
};
