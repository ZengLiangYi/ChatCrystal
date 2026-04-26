import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isChatCrystalServerProcess,
  parsePowerShellProcessJson,
  parseWindowsNetstatListenPid,
} from './processes.js';

test('parseWindowsNetstatListenPid finds the listening PID for a port', () => {
  const output = `
  TCP    0.0.0.0:3721           0.0.0.0:0              LISTENING       47992
  TCP    [::]:13721             [::]:0                 LISTENING       12345
`;

  assert.equal(parseWindowsNetstatListenPid(output, 3721), 47992);
});

test('parsePowerShellProcessJson reads process metadata', () => {
  const output = '{"ProcessId":47992,"CommandLine":"node chatcrystal/dist/server/src/cli/index.js serve","ExecutablePath":"C:\\\\Program Files\\\\nodejs\\\\node.exe"}';

  assert.deepEqual(parsePowerShellProcessJson(output), {
    pid: 47992,
    commandLine: 'node chatcrystal/dist/server/src/cli/index.js serve',
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
  });
});

test('isChatCrystalServerProcess allows CLI serve and standalone server entries', () => {
  assert.equal(isChatCrystalServerProcess({
    pid: 1,
    commandLine: '"C:/Program Files/nodejs/node.exe" "C:/Program Files/nodejs/node_modules/chatcrystal/dist/server/src/cli/index.js" serve',
  }), true);

  assert.equal(isChatCrystalServerProcess({
    pid: 2,
    commandLine: 'node C:/Users/Rayner/Project/ChatCrystal/server/dist/server/src/index.js',
  }), true);

  assert.equal(isChatCrystalServerProcess({
    pid: 3,
    commandLine: 'node C:/work/renamed-project/server/dist/server/src/index.js',
  }, ['C:/work/renamed-project/server']), true);
});

test('isChatCrystalServerProcess rejects unrelated port owners', () => {
  assert.equal(isChatCrystalServerProcess({
    pid: 4,
    commandLine: 'node C:/tmp/other-app/dist/server/src/index.js',
  }), false);

  assert.equal(isChatCrystalServerProcess({
    pid: 5,
    commandLine: 'node C:/Program Files/nodejs/node_modules/chatcrystal/dist/server/src/cli/index.js search query',
  }), false);
});
