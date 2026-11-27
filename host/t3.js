// apiVersion 8：host.t3 把 T3 自己的几组 atom 原样交给扩展读（manifest 要声明 permissions: ["t3-internals"]）。
// 这些是 T3 压缩代码里的内部对象：结构跟着 T3 版本走，宿主只保证在它针对的那个 T3 版本上绑定的是对的那一组（tests/verify.cjs 核对）。
// 宿主只给 get / subscribe，不给 registry.set：写操作照旧走 host.agent 这类整理过的接口。
const hasT3 = (rec) => rec.manifest.permissions?.includes("t3-internals") === true;
let t3Atoms = null;

function t3Api(rec, life) {
  // live：停用后晚到的回调不能再读（hook 不查：停用时扩展的组件都会卸载）
  const need = (live) => {
    if (!hasT3(rec)) throw new Error(L('host.t3 要在 permissions 里声明 "t3-internals"', 'host.t3 requires the "t3-internals" permission'));
    if (live && !life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
  };
  return Object.freeze({
    /** { server, threads, threadStatus, shells, environments, catalog }：T3 的 atom 集合，见扩展开发文档。 */
    get atoms() {
      need(true);
      // 只冻结外面这层：里面是 T3 自己的对象，冻结会改到 T3
      return (t3Atoms ??= Object.freeze({ ...bind.atoms.t3 }));
    },
    /** 当前值。 */
    get(atom) {
      need(true);
      return bind.atoms.registry.get(atom);
    },
    /** 值变了调 fn；返回取消函数，扩展停用时宿主自动取消。 */
    subscribe(atom, fn) {
      need(false);
      if (!life.alive) return () => {};
      const off = bind.atoms.registry.subscribe(atom, fn);
      life.disposers.push(off);
      return off;
    },
    /** hook：订阅 atom 的值（atom 为 null 时是 undefined）。 */
    useAtom(atom) {
      need(false);
      return useAtomValue(atom);
    },
  });
}
