"use strict";
// T3 Code 0.1.13 的补丁：只开几个口子，功能全部在扩展里。
//   1. ThreadRouteView 模块（聊天视图所在，_chat 静态导入它）：聊天视图把会话状态交给 chat.overlay；推理档位列表交给 composer.effort；末尾追加宿主。
//   2. 设置里新增“扩展”页：路由表、导航分组和名字、导航图标各改一处，页面组件放在外观设置页模块里（顶部沿用 T3 的项目/环境作用域选择）。
//   3. （仅独立数据模式）Electron userData 目录改名，和官方版各用各的单实例锁。
//   4. 后台扩展：preload、主进程、T3 后台（含 runtimeLayer）各加一段，见 patch-server.cjs。
// 支持 0.1.12 的是 v0.5.0，支持 0.1.11 的是 v0.1.0 这个 Release。
const assert = require("node:assert/strict");
const { MARKER, runtime } = require("./build.cjs");

const { t3Version: T3_VERSION } = require("../package.json"); // 补丁针对的官方版本；自动更新也按它下载官方安装包

function replaceOnce(text, anchor, replacement, label) {
  const parts = text.split(anchor);
  assert.equal(parts.length, 2, `找不到唯一的${label}位置（需要 T3 Code ${T3_VERSION}）`);
  return parts[0] + replacement + parts[1];
}

// 改过的模块和原 source map 对不上了，去掉引用。
const stripMap = (text) => text.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
const asset = (name) => new RegExp(`^apps/server/dist/client/assets/${name}-[\\w-]+\\.js$`);

// 聊天视图（lK）的返回值。会话状态的变量名来自 0.1.13 的压缩代码：
//   awaiting 照抄 T3 传给时间线的 awaitingUser；hl=正在运行；Hi=当前会话错误；da=会话 key；q.runs 末项=最后一次运行；
//   provider：线程开始后 Ys 锁定为正在运行的实例，可 handoff（li）时跟随选择器里的显式选择 ps；ds=provider 列表；h=side chat 里的嵌入视图。
const CHAT_VIEW_RETURN = "return(0,$.jsx)(gx,{threadRef:la,cwd:gd,checkpoints:q?.checkpoints,checkpointScopes:q?.checkpointScopes,children:my})";
const CHAT_STATE = [
  "threadKey:da",
  "awaiting:mc===null?hc!==null||ha?.hasPendingUserInput===!0?`input`:null:`approval`",
  "working:hl",
  // 上下文用量（T3 输入框里 Context 一栏用的同一个对象，可能为 null）和正在压缩历史。
  "context:vl",
  "compacting:fl",
  "error:Hi",
  "runStatus:q?.runs?.at(-1)?.status??null",
  "providerInstanceId:li&&ps||Ys",
  "providers:ds",
  "model:Zr?.modelSelection?.model??null",
  "subagents:q?.subagents",
  "embedded:h",
  // 会话所在的环境和项目：扩展可以按项目、按环境启用。la=会话引用，Zr=会话（草稿时为草稿），po=当前项目。
  "environmentId:la?.environmentId??null",
  "projectId:Zr?.projectId??po?.id??null",
].join(",");

const chatPatch = {
  id: "chat",
  label: "聊天视图模块",
  targetRegex: asset("ThreadRouteView"),
  originalHash: "5464ddf4e47841a1799079fdc05145474013f8c268224390b2dccf3f76521c9f",
  marker: MARKER,
  apply(text) {
    let out = replaceOnce(
      text,
      "function Xz(e){",
      "function Xz(e){return(0,$.jsx)(t3xHost.EffortSlot,{props:e,Default:t3xNativeEffort})}function t3xNativeEffort(e){",
      "推理档位列表",
    );
    out = replaceOnce(
      out,
      CHAT_VIEW_RETURN,
      `return(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(t3xHost.ChatOverlay,{state:{${CHAT_STATE}}}),${CHAT_VIEW_RETURN.slice("return".length)}]})`,
      "聊天视图",
    );
    return `${stripMap(out)}\n${runtime()}\n`;
  },
};

// 扩展页组件放在外观设置页模块里：要用的原生组件它都在模块顶层导入了
// （ce=设置页容器，de=Section，se=Row，W=Switch，f=Button，p=Input，
//   _e=Select，ge=SelectTrigger，pe=SelectValue，he=SelectPopup，fe=SelectItem，
//   xt/yt/bt=InputGroup/Addon/Input，lt/ct=Alert/AlertDescription，at=toast 管理器；
//   页面组件里有同名局部变量，所以只能在模块顶层取）。
// 再从设置布局模块导入作用域 hook（导出名 x，即 Et：读 SettingsScopeProvider，可能为 null），把顶部“Applying settings for …”选中的项目和环境交给扩展页。
const appearancePatch = {
  id: "appearance",
  label: "外观设置页模块",
  targetRegex: asset("_chat\\.settings\\.appearance"),
  originalHash: "71c3f11afa6e399636c2f9cce7aa6ad57cf5538e00cbd9ea407a0c1294c5efab",
  marker: "export{t3xExtensionsPage as t3xExtensions}",
  // 宿主没加载时页面不能是空白：给一句提示。
  apply: (text) =>
    // 外观页已经导入的 T3 组件直接用；Badge、Empty、Skeleton、AlertAction 它没导入，补几行 import（测试会核对这些导出名还在）。
    `${stripMap(text)}\nconst t3xUi={Section:de,Row:se,Switch:W,Button:f,Input:p,Select:_e,SelectTrigger:ge,SelectValue:pe,SelectPopup:he,SelectItem:fe,` +
    "InputGroup:xt,InputGroupAddon:yt,InputGroupInput:bt,Alert:lt,AlertDescription:ct,AlertAction:t3xAlertAction,toast:at,Badge:t3xBadge,Skeleton:t3xSkeleton," +
    "Empty:t3xEmpty,EmptyHeader:t3xEmptyHeader,EmptyTitle:t3xEmptyTitle,EmptyDescription:t3xEmptyDescription,EmptyContent:t3xEmptyContent};" +
    'import{di as t3xBadge}from"./utils-BRWZdN09.js";import{t as t3xSkeleton}from"./skeleton-DSLgalc_.js";import{n as t3xAlertAction}from"./alert-DPGwwO1I.js";' +
    'import{t as t3xEmpty,i as t3xEmptyHeader,o as t3xEmptyTitle,r as t3xEmptyDescription,n as t3xEmptyContent}from"./empty-BW-MkO2V.js";' +
    "function t3xNoExtensions(){return(0,$.jsx)(`p`,{className:`text-sm text-muted-foreground`,children:/^zh\\b/i.test(document.documentElement.lang)?`扩展宿主没有加载，看不到扩展设置。`:`The extension host did not load, so extension settings are unavailable.`})}" +
    "function t3xExtensionsPage(){let s=t3xUseScope();return(0,$.jsx)(ce,{children:(0,$.jsx)(globalThis.t3xHost?.SettingsPage??t3xNoExtensions,{ui:t3xUi,scope:s})})}" +
    'import{x as t3xUseScope}from"./settingsLayout-CFGUMImx.js";' +
    "export{t3xExtensionsPage as t3xExtensions};\n",
};

// 路由表：照抄外观页路由的懒加载写法（同一个模块、同一组预加载依赖），只换路径和导出名。R3=设置布局路由。
const routePatch = {
  id: "route",
  label: "路由表",
  targetRegex: asset("main"),
  originalHash: "c016e4750075b866ebfee6f747eef4db8e48fe7148556848bb9ca132b92ddd4d",
  marker: "ChatSettingsT3xExtensionsRoute:",
  apply(text) {
    const lazy = text.match(
      /x3=em\(`\/_chat\/settings\/appearance`\)\(\{component:(nm\(\(\)=>v_\(\(\)=>import\(`\.\/_chat\.settings\.appearance-[\w-]+\.js`\),__vite__mapDeps\(\[[\d,]+\]\)\),)`component`\)\}\)/,
    );
    assert(lazy, `找不到外观页路由（需要 T3 Code ${T3_VERSION}）`);
    const route = `em(\`/_chat/settings/extensions\`)({component:${lazy[1]}\`t3xExtensions\`)}).update({id:\`/extensions\`,path:\`/extensions\`,getParentRoute:()=>R3})`;
    return stripMap(
      replaceOnce(text, "y6={ChatSettingsAboutRoute:h6,", `y6={ChatSettingsT3xExtensionsRoute:${route},ChatSettingsAboutRoute:h6,`, "设置路由表"),
    );
  },
};

// 导航分组（放在“外观”后面）、导航名字、设置搜索和命令面板的条目（跳到页面里两个区块），作用域登记为本机（null）。
// 名字写英文原文，中文由 i18nPatch 补进 T3 的翻译函数。
const navPatch = {
  id: "nav",
  label: "设置导航",
  targetRegex: asset("settingsSearch"),
  originalHash: "32f90174c9fb4d774736a818aa1fe2807daee0d624163589d5775e435d4a2822",
  marker: '"/settings/extensions":p(`Extensions`)',
  apply(text) {
    const group = "paths:[`/settings/general`,`/settings/appearance`,";
    let out = replaceOnce(text, group, `${group}\`/settings/extensions\`,`, "设置导航分组");
    const names = '"/settings/archived":p(`Archive`)}';
    out = replaceOnce(out, `${names},be={...W,`, `${names.slice(0, -1)},"/settings/extensions":p(\`Extensions\`)},be={...W,`, "设置导航名字");
    const items =
      "{id:`t3x-installed`,title:`Extensions`,to:`/settings/extensions`,searchTerms:[`extensions plugins pets edge glow effort slider 扩展 插件 桌宠 边缘光 推理强度滑条`]}," +
      "{id:`t3x-market`,title:`Extension marketplace`,to:`/settings/extensions`,searchTerms:[`extension marketplace registry install 扩展市场 安装扩展 添加扩展`]},";
    out = replaceOnce(out, "{id:`color-scheme`", `${items}{id:\`color-scheme\``, "设置搜索条目");
    const scopes = 'Oe={"/settings/diagnostics":`environment`,';
    out = replaceOnce(out, scopes, scopes.replace("Oe={", 'Oe={"/settings/extensions":null,'), "设置搜索作用域");
    return stripMap(out);
  },
};

// T3 的界面原文是英文，渲染时用 gt 的翻译函数按当前语言查表；中文表是冻结的模块，加不进条目。
// 在翻译函数入口认出补丁加的几条英文原文：中文界面返回中文，其他语言返回原文。导航、设置搜索、命令面板都走这里。
const T3X_MESSAGES = { Extensions: "扩展", "Extension marketplace": "扩展市场" };
const i18nPatch = {
  id: "i18n",
  label: "翻译函数",
  targetRegex: /^apps\/server\/dist\/client\/assets\/utils-BRWZdN09\.js$/,
  originalHash: "71312f2f21f4d654034f92544212ec0555d97b46171e8b1971c09c9084e1a527",
  marker: "t3xMessages",
  apply(text) {
    const anchor = "return(0,J.useCallback)((e,a={})=>{let o=N(a.$locale??t,a,`ICU`);";
    // n=shouldTranslate：T3 关掉翻译时走原路径，和其他文案保持一致。
    const hook = "if(n&&typeof e==`string`&&Object.hasOwn(t3xMessages,e))return/^zh\\b/i.test(a.$locale??t)?t3xMessages[e]:e;";
    const out = replaceOnce(text, anchor, anchor.replace("{let o=", `{${hook}let o=`), "翻译函数");
    return `${stripMap(out)}\nconst t3xMessages=${JSON.stringify(T3X_MESSAGES)};\n`;
  },
};

// 导航图标：每个导航项都必须有图标组件，否则整个设置导航渲染失败。K=jsx 运行时。
const navIconPatch = {
  id: "nav-icon",
  label: "设置布局模块",
  targetRegex: asset("_chat\\.settings"),
  originalHash: "1e5aa14f845ffcbede9cb328cfc47523479f4bd8115e50a2e09a9b6282844887",
  marker: "function t3xExtensionsIcon(",
  apply: (text) =>
    `${stripMap(replaceOnce(text, 'Ue={"/settings/general":ye,', 'Ue={"/settings/extensions":t3xExtensionsIcon,"/settings/general":ye,', "设置导航图标"))}\n` +
    'function t3xExtensionsIcon(e){return(0,K.jsxs)(`svg`,{xmlns:`http://www.w3.org/2000/svg`,width:24,height:24,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:2,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":!0,...e,' +
    "children:[(0,K.jsx)(`rect`,{x:3,y:3,width:8,height:8,rx:1.5}),(0,K.jsx)(`rect`,{x:3,y:13,width:8,height:8,rx:1.5}),(0,K.jsx)(`rect`,{x:13,y:13,width:8,height:8,rx:1.5}),(0,K.jsx)(`path`,{d:`M17 3v8M13 7h8`})]})}\n",
};

const PROFILE_NAME = "t3-extensions-profile";
const userDataPatch = {
  id: "user-data",
  label: "Electron 用户数据目录",
  targetRegex: /^apps\/desktop\/dist-electron\/main\.cjs$/,
  originalHash: "80eb399935ad079a3f3084ca6da80dd495fbe9b69f473831819361223a50c559",
  marker: `"${PROFILE_NAME}/electron"`,
  module: "commonjs",
  apply: (text) => replaceOnce(text, 'current: "t3code-v2",', `current: "${PROFILE_NAME}/electron",`, "userData 目录名"),
};

module.exports = { T3_VERSION, PROFILE_NAME, chatPatch, appearancePatch, routePatch, navPatch, navIconPatch, i18nPatch, userDataPatch, replaceOnce, stripMap };
