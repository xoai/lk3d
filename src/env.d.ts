// What the sources use of Node: validate.js and lint.js, which also run in a browser, read a scene from stdin when run
// directly with node (and look for `process` first).
declare const process:
  | {
      argv: string[];
      stdin: { setEncoding(e: string): void; on(ev: string, f: (d?: any) => void): void };
      exitCode?: number;
    }
  | undefined;
