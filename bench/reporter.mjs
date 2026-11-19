import { appendFileSync, writeFileSync } from 'node:fs';

let initialised = false;

export default class BenchReporter {
  onUserConsoleLog(log) {
    if (!initialised) {
      writeFileSync('bench/latest.log', '');
      initialised = true;
    }
    appendFileSync('bench/latest.log', `${String(log.content)}\n`);
  }
}
