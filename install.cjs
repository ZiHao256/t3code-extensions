#!/usr/bin/env node
"use strict";
// macOS：把官方 T3 Code（版本见 lib/patch.cjs 的 T3_VERSION）复制一份到 ~/Applications，打上扩展宿主补丁，本机重新签名。官方版不动。
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readAsar, findOne, writeAsar, checkModuleSyntax, sha256 } = require("./lib/asar.cjs");
const { T3_VERSION, PROFILE_NAME, chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, userDataPatch } = require("./lib/patch.cjs");
const { preloadPatch, mainServerPatch, serverPatch, managedPatch } = require("./lib/patch-server.cjs");
const { t3xNewerVersion } = require("./host/pure.js");

const DEFAULT_SOURCE = "/Applications/T3 Code (Beta).app";
const T3_TEAM_ID = "ARK85ZXQ4Z";
const T3_BUNDLE_ID = "com.t3tools.t3code";
const APP_NAME = "T3 Code Extensions";
const BUNDLE_ID = "local.t3-extensions.app";
const APP_ASAR = path.join("Contents", "Resources", "app.asar");
const INFO_PLIST = path.join("Contents", "Info.plist");
const APPS_DIR = path.join(os.homedir(), "Applications");
const INSTALL_DIR = path.join(APPS_DIR, `${APP_NAME}.app`);
const PROFILE_DIR = path.join(os.homedir(), "Library", "Application Support", PROFILE_NAME);
const ISOLATED_PORT = "3775";
const CACHE_DIR = path.join(os.homedir(), "Library", "Caches", "t3code-extensions"); // 自动更新的下载和结果，见 host/update-main.cjs

const PATCHES = [chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, preloadPatch, mainServerPatch, serverPatch, managedPatch];
const patchesFor = (isolated) => (isolated ? [...PATCHES, userDataPatch] : PATCHES);

function plist(app, key, format = "raw") {
  const out = execFileSync("plutil", ["-extract", key, format, "-o", "-", path.join(app, INFO_PLIST)], { encoding: "utf8" });
  return format === "json" ? JSON.parse(out) : out.trim();
}

function setPlist(app, key, value) {
  execFileSync("plutil", ["-replace", key, "-json", JSON.stringify(value), path.join(app, INFO_PLIST)]);
}

function isOurs() {
  if (!fs.existsSync(path.join(INSTALL_DIR, INFO_PLIST))) return false;
  return plist(INSTALL_DIR, "CFBundleIdentifier") === BUNDLE_ID;
}

const isIsolated = () => "T3CODE_HOME" in plist(INSTALL_DIR, "LSEnvironment", "json");

/** 正在运行 app 里主程序的进程，不算自己：自动更新时本脚本就是用这个程序（ELECTRON_RUN_AS_NODE）跑的。 */
function runningPids(app) {
  const exe = path.join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"));
  assert(fs.existsSync(exe), `找不到可执行文件：${exe}`);
  try {
    const out = execFileSync("lsof", ["-t", exe], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
  } catch (error) {
    if (error.status === 1) return []; // lsof 没找到进程
    throw error;
  }
}
const isRunning = (app = INSTALL_DIR) => runningPids(app).length > 0;

/** 给 asar 打补丁写到 outFile；每个目标文件先核对 T3_VERSION 的原始哈希，同一个文件的几个补丁依次打上。返回头部哈希。 */
function patchArchive(asarFile, patches, outFile) {
  const asar = readAsar(asarFile);
  const byKey = new Map();
  for (const p of patches) {
    const key = findOne(asar, p.targetRegex, p.label);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const replacements = new Map();
  for (const [key, list] of byKey) {
    const original = asar.read(key);
    for (const p of list) assert.equal(sha256(original), p.originalHash, `${key} 和 T3 Code ${T3_VERSION} 不一致`);
    const patched = Buffer.from(list.reduce((text, p) => p.apply(text), original.toString("utf8")), "utf8");
    checkModuleSyntax(patched, key, list[0].module === "commonjs" ? ".cjs" : ".mjs");
    replacements.set(key, patched);
  }
  return writeAsar(asar, replacements, outFile);
}

function verifyOfficial(app) {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--test-requirement", `=anchor apple generic and certificate leaf[subject.OU] = "${T3_TEAM_ID}"`, app], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    throw new Error(`官方签名校验失败，请重新安装官方 T3 Code ${T3_VERSION}：${error.stderr?.toString().trim()}`);
  }
}

function status() {
  if (!fs.existsSync(INSTALL_DIR)) return console.log("尚未安装。");
  assert(isOurs(), `安装位置被其他应用占用：${INSTALL_DIR}`);
  const installed = plist(INSTALL_DIR, "CFBundleShortVersionString");
  assert.equal(installed, T3_VERSION, `已安装的是基于 T3 Code ${installed} 的版本，这一版针对 ${T3_VERSION}：先退出应用，运行 node install.cjs uninstall，再 install`);
  const isolated = isIsolated();
  const asar = readAsar(path.join(INSTALL_DIR, APP_ASAR));
  for (const p of patchesFor(isolated)) {
    const text = asar.read(findOne(asar, p.targetRegex, p.label)).toString("utf8");
    assert(text.includes(p.marker), `${p.label}的补丁不完整，请卸载后重装`);
  }
  console.log(`${APP_NAME}（T3 Code ${T3_VERSION}）已安装，${isRunning() ? "运行中" : "未运行"}。`);
  console.log(`启动：open "${INSTALL_DIR}"`);
  console.log(isolated ? `独立数据：${PROFILE_DIR}（端口 ${ISOLATED_PORT}，可与官方版同时运行）` : "数据：与官方版共用 ~/.t3，两者不能同时运行");
}

function install(source = DEFAULT_SOURCE, isolated = false) {
  if (fs.existsSync(INSTALL_DIR)) return status();
  withBuild(source, isolated, (app) => fs.renameSync(app, INSTALL_DIR));
  status();
}

/** 在 ~/Applications 下的临时目录里做好打过补丁、重新签名的 app，交给 place 放到位；临时目录最后删掉。 */
function withBuild(source, isolated, place) {
  const from = path.resolve(source);
  assert.equal(plist(from, "CFBundleShortVersionString"), T3_VERSION, `需要官方 T3 Code ${T3_VERSION}`);
  fs.mkdirSync(APPS_DIR, { recursive: true });
  const staging = fs.mkdtempSync(path.join(APPS_DIR, ".t3-extensions-"));
  try {
    const app = path.join(staging, `${APP_NAME}.app`);
    console.log("复制并校验官方签名…");
    execFileSync("ditto", [from, app]);
    verifyOfficial(app); // 校验复制出来的这份，保证补丁打在官方签名覆盖的文件上
    execFileSync("xattr", ["-dr", "com.apple.quarantine", app]);
    console.log("打补丁…");
    const target = path.join(app, APP_ASAR);
    const headerHash = patchArchive(target, patchesFor(isolated), `${target}.patched`);
    fs.chmodSync(`${target}.patched`, fs.statSync(target).mode & 0o777);
    fs.renameSync(`${target}.patched`, target);
    setPlist(app, "ElectronAsarIntegrity", { "Resources/app.asar": { algorithm: "SHA256", hash: headerHash } });
    setPlist(app, "CFBundleIdentifier", BUNDLE_ID);
    setPlist(app, "CFBundleDisplayName", APP_NAME);
    setPlist(app, "LSEnvironment", {
      ...plist(app, "LSEnvironment", "json"),
      ...(isolated ? { T3CODE_HOME: path.join(PROFILE_DIR, "t3-home"), T3CODE_PORT: ISOLATED_PORT } : {}),
      T3CODE_DISABLE_AUTO_UPDATE: "1", // 自动更新会换掉打过补丁的文件
    });
    console.log("本机重新签名…");
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "pipe" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
    place(app);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function uninstall() {
  if (!fs.existsSync(INSTALL_DIR)) return status();
  assert(isOurs(), `无法确认是本工具安装的应用：${INSTALL_DIR}`);
  assert(!isRunning(), `请先退出 ${APP_NAME}`);
  const isolated = isIsolated();
  fs.rmSync(INSTALL_DIR, { recursive: true });
  console.log(isolated ? `已卸载。独立数据保留在 ${PROFILE_DIR}` : "已卸载。会话和项目仍在 ~/.t3");
}

/** 把 official 换成 app（下载解开的官方版）。那里放的不是官方 T3、比 app 新、正在运行，或者 macOS 不让动（App Management）时不换，返回原因。 */
function replaceOfficial(app, official) {
  const has = fs.existsSync(official);
  if (has) {
    if (plist(official, "CFBundleIdentifier") !== T3_BUNDLE_ID) return `${official} 不是官方 T3 Code，没有替换`;
    const current = plist(official, "CFBundleShortVersionString");
    if (t3xNewerVersion(current, plist(app, "CFBundleShortVersionString"))) return `「应用程序」里的官方版已经是 ${current}，没有替换`;
    if (isRunning(official)) return "官方版正在运行，没有替换，可以退出后在官方版里自己更新";
  }
  const old = path.join(path.dirname(official), `.${path.basename(official)}.t3x-old`);
  const skipped = (error) => `没能替换「应用程序」里的官方版（${error.code ?? error.message}），这次用下载的官方包安装`;
  try {
    if (has) fs.renameSync(official, old);
  } catch (error) {
    return skipped(error);
  }
  try {
    fs.renameSync(app, official);
  } catch (error) {
    if (!has) return skipped(error);
    try {
      fs.renameSync(old, official);
    } catch {
      throw new Error(`没能把官方版放回原处，原来的官方版在 ${old}`); // 停下这次更新，别在空着的位置上接着装
    }
    return skipped(error);
  }
  if (has) fs.rmSync(old, { recursive: true, force: true });
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 重新打开 app：去掉更新器自己用的 Electron 变量，免得传给 app。 */
function reopen(app) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  execFileSync("open", [app], { env });
}

/**
 * 自动更新（窗口里点“更新”后由主进程启动，见 host/update-main.cjs）：等 app 完全退出，需要时先换官方版，再重装、重新打开。
 * work 是主进程的下载目录：source/ 是这一版的源码（本文件就在里面）；有 official.zip 说明官方版要换成 T3_VERSION。
 * 结果写到 update-result.json，app 下次启动时提示。没做成时原来的 app 不动。
 */
async function update(work, { official = DEFAULT_SOURCE, open = reopen, exitTimeout = 10 * 60_000 } = {}) {
  // 最后会整个删掉 work：只认主进程在缓存目录里直接建的下载目录（不是链接），而且本脚本就在它的 source/ 里。不对就什么都不动
  const realWork = fs.realpathSync(work);
  assert(
    !fs.lstatSync(work).isSymbolicLink() && /^work-[\w-]+$/.test(path.basename(realWork)) && path.dirname(realWork) === fs.realpathSync(CACHE_DIR) && fs.realpathSync(__dirname) === path.join(realWork, "source"),
    `不是自动更新的下载目录：${work}`,
  );
  assert(isOurs(), `无法确认是本工具安装的应用：${INSTALL_DIR}`);
  // 报到：主进程等到它才退出 app。之后只剩等 app 退出，出什么错都会写结果、重新打开 app
  fs.writeFileSync(path.join(work, "ready"), "");
  const result = { version: require("./package.json").version, t3Version: T3_VERSION };
  let keepWork = false;
  try {
    // T3 退出前要等后台关完，卡住时它自己会强制退出
    for (const end = Date.now() + exitTimeout; isRunning(); await sleep(500)) assert(Date.now() < end, `${APP_NAME} 没有退出，没有更新`);
    let source = official;
    const zip = path.join(work, "official.zip");
    if (fs.existsSync(zip)) {
      const out = path.join(work, "official");
      console.log("解开官方安装包…");
      execFileSync("ditto", ["-x", "-k", zip, out]);
      const apps = fs.readdirSync(out).filter((name) => name.endsWith(".app"));
      assert.equal(apps.length, 1, "官方安装包里应该正好有一个 app");
      source = path.join(out, apps[0]);
      assert(plist(source, "CFBundleIdentifier") === T3_BUNDLE_ID && plist(source, "CFBundleShortVersionString") === T3_VERSION, `官方安装包不是 T3 Code ${T3_VERSION}`);
      verifyOfficial(source);
      result.warning = replaceOfficial(source, official) ?? undefined;
      if (!result.warning) source = official;
    }
    // 新版做好了才换下旧的：做的时候还要用旧 app 里的程序（本进程 process.execPath）检查补丁语法，失败了旧的原样留着
    const previous = path.join(work, `${APP_NAME}.app`);
    withBuild(source, isIsolated(), (app) => {
      assert(!isRunning(), `${APP_NAME} 又被打开了，这次没有替换`); // 做新版的这一会儿里
      fs.renameSync(INSTALL_DIR, previous);
      try {
        fs.renameSync(app, INSTALL_DIR);
      } catch (error) {
        try {
          fs.renameSync(previous, INSTALL_DIR);
        } catch {
          keepWork = true; // 原来的 app 只剩这一份，留着
          throw new Error(`${error.message}；原来的 app 在 ${previous}`);
        }
        throw error;
      }
    });
    console.log(`已更新到 ${result.version}`);
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
    console.error("错误：", error.message);
  }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(CACHE_DIR, "update-result.json"), JSON.stringify(result));
  } catch (error) {
    console.error("没能写下更新结果：", error.message); // 照样重新打开 app
  }
  // app 还开着（没等到它退出）就不用再开
  if (isOurs() && !isRunning()) {
    try {
      open(INSTALL_DIR);
    } catch (error) {
      console.error("没能重新打开：", error.message);
    }
  }
  if (!keepWork) fs.rmSync(work, { recursive: true, force: true }); // 旧 app 也在里面；本进程还在用它的程序文件，删了不影响已经在跑的进程
  return result;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const isolated = args.includes("--isolated");
    const [command, source, ...extra] = args.filter((a) => a !== "--isolated");
    if (!command || command === "--help") {
      console.log(`用法：node install.cjs install [--isolated] [官方 T3 Code.app，默认 ${DEFAULT_SOURCE}] | status | uninstall`);
    } else {
      assert(process.platform === "darwin", "目前只支持 macOS");
      assert(process.getuid() !== 0, "请用桌面用户运行，不要 sudo");
      assert(extra.length === 0 && (command === "install" || (command === "update" && source && !isolated) || (source === undefined && !isolated)), "参数不正确");
      if (command === "install") install(source, isolated);
      else if (command === "update") {
        update(path.resolve(source)).then(
          (r) => (process.exitCode = r.ok ? 0 : 1),
          (error) => {
            console.error("错误：", error.message);
            process.exitCode = 1;
          },
        );
      }
      else if (command === "status") status();
      else if (command === "uninstall") uninstall();
      else throw new Error(`未知命令：${command}`);
    }
  } catch (error) {
    console.error("错误：", error.message);
    process.exitCode = 1;
  }
}

module.exports = { patchArchive, patchesFor, replaceOfficial, update };
