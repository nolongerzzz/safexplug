'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (a) => ipcRenderer.invoke(ch, a);
contextBridge.exposeInMainWorld('wallet', {
  init: call('w:init'), downloadTools: call('w:download-tools'), pickFile: call('w:pick-file'), listWallets: call('w:list-wallets'),
  createWallet: call('w:create-wallet'), checkNode: call('w:check-node'), unlock: call('w:unlock'), lock: call('w:lock'),
  snapshot: call('w:snapshot'), keys: call('w:keys'), adopt: call('w:adopt-wallet'), copySecret: call('w:copy-secret'), prepare: call('w:prepare'), prepareSplit: call('w:prepare-split'), prepareSweep: call('w:prepare-sweep'), addrList: call('w:addr-list'), addrSave: call('w:addr-save'), addrRemove: call('w:addr-remove'), confirm: call('w:confirm'), cancel: call('w:cancel'), copy: call('w:copy'), offers: call('w:offers'), staking: call('w:staking'), stakeQuote: call('w:stake-quote'), offer: call('w:offer'), buyQuote: call('w:buy-quote'), sellerQuote: call('w:seller-quote'), actConfirm: call('w:act-confirm'), refresh: call('w:refresh'), backup: call('w:backup'), seed: call('w:seed'), rescan: call('w:rescan'), catchUp: call('w:catch-up'), busy: call('w:busy'),
  exRecent: call('ex:recent'), exBlock: call('ex:block'), exTx: call('ex:tx'), exPool: call('ex:pool'), flags: call('w:flags'),
  help: call('w:help'), refreshTools: call('w:refresh-tools'), sellerListings: call('w:seller-listings'), sellerAccounts: call('w:seller-accounts'), sellerImport: call('w:seller-import'), sellerToggle: call('w:seller-toggle'), sellerEdit: call('w:seller-edit'), swConfig: call('w:sw-config'), swStatus: call('w:sw-status'), swBook: call('w:sw-book'), swPost: call('w:sw-post'), swTake: call('w:sw-take'), swAnswer: call('w:sw-answer'), swAct: call('w:sw-act'), swClear: call('w:sw-clear'),
  updateCheck: call('w:update-check'), updateApply: call('w:update-apply'),
  onOpenExplorer: (fn) => ipcRenderer.on('w:open-explorer', () => fn()),
  onLog: (fn) => ipcRenderer.on('w:log', (_e, m) => fn(m)),
});
