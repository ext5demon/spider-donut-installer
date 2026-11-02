const { contextBridge, ipcRenderer } = require('electron');
async function call(method, ...args) {
  const result = await ipcRenderer.invoke('installer:' + method, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('installer', Object.freeze({
  init: () => call('init'), catalog: refresh => call('catalog', refresh),
  issueKey: options => call('issue-key', options),
  unlockKey: password => call('unlock-key', password), generatePassword: () => call('generate-password'), backupIssuer: password => call('backup-issuer', password),
  chooseGame: () => call('choose-game'), chooseOutput: () => call('choose-output'), chooseKey: () => call('choose-key'),
  start: request => call('start', request), cancel: () => call('cancel'), installRuntime: () => call('install-runtime'),
  reveal: () => call('reveal'), openOutput: () => call('open-output'), openLink: url => call('open-link', url),
  capture: rect => call('capture', rect), edit: action => call('edit', action), quit: () => call('quit'),
  onEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('installer:event', listener); return () => ipcRenderer.removeListener('installer:event', listener); }
}));
