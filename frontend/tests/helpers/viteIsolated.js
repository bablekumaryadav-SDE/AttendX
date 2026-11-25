import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

let viteModule;
let networkProbePatched = false;

/**
 * Vite 7 probes Windows network-drive mappings with `net use` while resolving
 * real paths. That optional OS probe is denied in restricted runners. Return
 * an error only for that exact command; Vite's own fallback keeps local path
 * resolution unchanged. All other child-process operations remain untouched.
 */
export async function createIsolatedViteServer(options) {
  if (!networkProbePatched) {
    const originalExec = childProcess.exec;
    childProcess.exec = function isolatedExec(command, ...args) {
      if (String(command).trim() === "net use") {
        const callback = args.find((value) => typeof value === "function");
        if (callback) {
          queueMicrotask(() => callback(
            Object.assign(new Error("Optional Windows network-drive probe disabled in isolated tests."), { code: "EPERM" }),
            "",
            "",
          ));
        }
        return null;
      }
      return originalExec.call(this, command, ...args);
    };
    syncBuiltinESMExports();
    networkProbePatched = true;
  }

  viteModule ??= await import("vite");
  return viteModule.createServer(options);
}
