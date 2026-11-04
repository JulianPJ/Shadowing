import initSqlJs from 'sql.js';
import { parsePackage } from './package';
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const SQL = await initSqlJs({ locateFile: () => '/anki/sql-wasm.wasm' });
    self.postMessage({ data: await parsePackage(event.data.file, SQL) });
  } catch {
    self.postMessage({
      error:
        'This package could not be read. It may be malformed, unsupported or too large. Export a smaller .apkg from Anki and try again.',
    });
  }
};
