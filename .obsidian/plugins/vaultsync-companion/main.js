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
  default: () => VaultSyncPlugin
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
var SKIP = [".obsidian/", ".vaultsync/"];
var skip = (path) => SKIP.some((p) => path.startsWith(p));
var GH_API = "https://api.github.com";
var GH_RAW = "https://raw.githubusercontent.com";
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
  // ---------- Public API -----------------------------------------------------
  async pull() {
    const ctx = await this.context();
    if (!ctx)
      return;
    try {
      await this.doPull(ctx);
    } catch (e) {
      this.notify(`VaultSync pull failed: ${e.message}`);
    }
  }
  async push() {
    const ctx = await this.context();
    if (!ctx)
      return;
    try {
      await this.doPush(ctx);
    } catch (e) {
      this.notify(`VaultSync push failed: ${e.message}`);
    }
  }
  async sync() {
    if (this.syncing)
      return;
    this.syncing = true;
    const ctx = await this.context();
    if (!ctx) {
      this.syncing = false;
      return;
    }
    try {
      const conflicts = await this.doPull(ctx);
      if (conflicts.length === 0) {
        await this.doPush(ctx);
      }
    } catch (e) {
      this.notify(`VaultSync sync failed: ${e.message}`);
    } finally {
      this.syncing = false;
    }
  }
  // ---------- Core pull ------------------------------------------------------
  async doPull(ctx) {
    const { config, token } = ctx;
    const { owner, repo, branch } = config;
    const ref = await this.ghGet(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
    const remoteSha = ref.object.sha;
    if (!this.manifest) {
      this.manifest = await this.bootstrap(config, token, remoteSha);
      this.onManifestChange(this.manifest);
      return [];
    }
    if (remoteSha === this.manifest.headSha)
      return [];
    const remoteCommit = await this.ghGet(`/repos/${owner}/${repo}/git/commits/${remoteSha}`, token);
    const remoteTree = await this.ghGet(`/repos/${owner}/${repo}/git/trees/${remoteCommit.tree.sha}?recursive=1`, token);
    const remoteBlobs = remoteTree.tree.filter(
      (e) => e.type === "blob" && !!e.path && !skip(e.path)
    );
    const remoteChanged = remoteBlobs.filter((e) => {
      var _a;
      return ((_a = this.manifest.files[e.path]) == null ? void 0 : _a.blobSha) !== e.sha;
    });
    const remotePathSet = new Set(remoteBlobs.map((e) => e.path));
    const remoteDeleted = Object.keys(this.manifest.files).filter((p) => !remotePathSet.has(p));
    const localMod = /* @__PURE__ */ new Set();
    for (const file of this.vaultFiles()) {
      const prev = this.manifest.files[file.path];
      if (!prev)
        continue;
      const content = await this.app.vault.readBinary(file);
      if (hashContent(content) !== prev.contentHash)
        localMod.add(file.path);
    }
    const conflicts = [];
    const updatedFiles = { ...this.manifest.files };
    for (const entry of remoteChanged) {
      if (localMod.has(entry.path)) {
        conflicts.push(entry.path);
        continue;
      }
      const content = await this.downloadRaw(owner, repo, remoteSha, entry.path, token);
      await this.writeVaultFile(entry.path, content);
      updatedFiles[entry.path] = { blobSha: entry.sha, contentHash: hashContent(content) };
    }
    for (const path of remoteDeleted) {
      if (localMod.has(path))
        continue;
      await this.deleteVaultFile(path);
      delete updatedFiles[path];
    }
    const existingConflicts = new Set(this.manifest.conflicts);
    const allConflicts = [.../* @__PURE__ */ new Set([...existingConflicts, ...conflicts])];
    this.manifest = { ...this.manifest, headSha: remoteSha, files: updatedFiles, conflicts: allConflicts };
    this.onManifestChange(this.manifest);
    if (conflicts.length > 0)
      this.notifyConflicts(conflicts);
    return allConflicts;
  }
  // ---------- Core push ------------------------------------------------------
  async doPush(ctx, retried = false) {
    const { config, token } = ctx;
    const { owner, repo, branch } = config;
    if (!this.manifest)
      return;
    const unresolved = new Set(this.manifest.conflicts);
    const changed = [];
    const changedPaths = [];
    for (const file of this.vaultFiles()) {
      if (unresolved.has(file.path))
        continue;
      const content = await this.app.vault.readBinary(file);
      const hash = hashContent(content);
      const prev = this.manifest.files[file.path];
      if (!prev || prev.contentHash !== hash) {
        changed.push({ path: file.path, content });
        changedPaths.push(file.path);
      }
    }
    const localPaths = new Set(this.vaultFiles().map((f) => f.path));
    const deleted = Object.keys(this.manifest.files).filter((p) => !localPaths.has(p) && !unresolved.has(p));
    if (changed.length === 0 && deleted.length === 0)
      return;
    const liveRef = await this.ghGet(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
    const liveHeadSha = liveRef.object.sha;
    if (liveHeadSha !== this.manifest.headSha && !retried) {
      await this.doPull(ctx);
      await this.doPush(ctx, true);
      return;
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
      { message, tree: newTree.sha, parents: [liveHeadSha], author: { name: "VaultSync", email: "sync@vaultsync.app", date: now } }
    );
    try {
      await this.ghPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, { sha: newCommit.sha, force: false });
    } catch (e) {
      if (!retried && e.message.includes("422")) {
        await this.doPull(ctx);
        await this.doPush(ctx, true);
        return;
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
  }
  // ---------- Bootstrap (first run) ------------------------------------------
  async bootstrap(config, token, headSha) {
    var _a;
    const { owner, repo } = config;
    const headCommit = await this.ghGet(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
    const remoteTree = await this.ghGet(`/repos/${owner}/${repo}/git/trees/${headCommit.tree.sha}?recursive=1`, token);
    const remoteMap = new Map(
      remoteTree.tree.filter((e) => e.type === "blob" && !!e.path && !skip(e.path)).map((e) => [e.path, e.sha])
    );
    const files = {};
    for (const file of this.vaultFiles()) {
      const content = await this.app.vault.readBinary(file);
      files[file.path] = { blobSha: (_a = remoteMap.get(file.path)) != null ? _a : "", contentHash: hashContent(content) };
    }
    return { headSha, files, conflicts: [] };
  }
  // ---------- Vault I/O -------------------------------------------------------
  vaultFiles() {
    return this.app.vault.getFiles().filter((f) => !skip(f.path));
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
    if (file)
      await this.app.vault.trash(file, false);
  }
  // ---------- GitHub API helpers ----------------------------------------------
  async ghFetch(method, path, token, body) {
    var _a;
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
        throw new Error("GitHub authentication failed. Check your token in VaultSync plugin settings.");
      throw new Error(`GitHub API ${res.status}: ${((_a = res.text) != null ? _a : "").slice(0, 200)}`);
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
  async context() {
    const token = this.settings.githubToken;
    if (!token)
      return null;
    const config = await this.readConfig();
    if (!config) {
      this.notify("VaultSync: vault not set up. Clone a repo in the VaultSync app first.");
      return null;
    }
    return { config, token };
  }
  async readConfig() {
    try {
      const raw = await this.app.vault.adapter.read(".vaultsync/config.json");
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
  notifyConflicts(paths) {
    const count = paths.length;
    const n = new import_obsidian.Notice(
      `VaultSync: ${count} conflict${count !== 1 ? "s" : ""} detected. Open VaultSync to resolve.`,
      0
    );
    n.noticeEl.addEventListener("click", () => {
      var _a, _b, _c;
      const url = `vaultsync://conflicts?vaultId=${encodeURIComponent(this.app.vault.getName())}`;
      (_c = (_b = (_a = this.app).openUrl) == null ? void 0 : _b.call(_a, url)) != null ? _c : window.open(url);
      n.hide();
    });
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  githubToken: "",
  syncInterval: 15,
  syncOnOpen: true,
  syncOnClose: true
};
var VaultSyncSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("GitHub token").setDesc("Personal access token with repo read/write scope. Same token used in VaultSync.").addText(
      (text) => text.setPlaceholder("ghp_...").setValue(this.plugin.settings.githubToken).onChange(async (value) => {
        this.plugin.settings.githubToken = value.trim();
        await this.plugin.saveSettings();
      }).inputEl.setAttribute("type", "password")
    );
    new import_obsidian2.Setting(containerEl).setName("Sync interval").setDesc("How often to push and pull while Obsidian is open.").addDropdown(
      (drop) => drop.addOption("0", "Disabled").addOption("1", "Every 1 minute").addOption("5", "Every 5 minutes").addOption("15", "Every 15 minutes").addOption("30", "Every 30 minutes").addOption("60", "Every hour").setValue(String(this.plugin.settings.syncInterval)).onChange(async (value) => {
        this.plugin.settings.syncInterval = parseInt(value);
        await this.plugin.saveSettings();
      })
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
    new import_obsidian2.Setting(containerEl).setName("Sync now").setDesc("Manually trigger a full push and pull.").addButton(
      (btn) => btn.setButtonText("Sync").onClick(async () => {
        btn.setButtonText("Syncing\u2026");
        btn.setDisabled(true);
        await this.plugin.engine.sync();
        btn.setButtonText("Sync");
        btn.setDisabled(false);
      })
    );
  }
};

// src/main.ts
var VaultSyncPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.intervalHandle = null;
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
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => this.engine.sync()
    });
    if (this.settings.syncOnOpen) {
      this.app.workspace.onLayoutReady(() => this.engine.pull());
    }
    this.scheduleInterval();
    if (this.settings.syncOnClose) {
      const handleVisibility = () => {
        if (document.visibilityState === "hidden")
          this.engine.push();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      this.register(() => document.removeEventListener("visibilitychange", handleVisibility));
    }
  }
  onunload() {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  scheduleInterval() {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.settings.syncInterval > 0) {
      this.intervalHandle = window.setInterval(
        () => this.engine.sync(),
        this.settings.syncInterval * 60 * 1e3
      );
    }
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
