# Safex Community Miner 2.1

One-click Safex (SFX) mining for Windows, Mac and Linux. MIT licensed. Uses the Safex xmrig engine (6.26.0 on Linux, `rx/sfx`).

## What's new in 2.1

- **Live viewport**: the miner's real output, colour-coded, with Follow / Copy / Clear.
- **Status strip**: status light, hashrate, threads, accepted/rejected shares, blocks found.
- **Two modes**: **Pool** (as before) and **My Node (solo)**, which mines directly against your own `safexd` (`--daemon`, default `127.0.0.1:17402`).
- **Node check**: in solo mode the app polls your node and shows Synced / Syncing with progress. "Wait for synced node" holds Start until the node is at the tip, then starts by itself.
- **Warnings that matter**: tells you when CPU tuning (MSR) or huge pages didn't apply, the usual cause of low hashrate.
- **Settings are remembered**, plus an optional "Start mining when app opens".
- **Developer donation is a visible setting** (xmrig's default is 1%).
- Modernised: current Electron, context isolation on, no Node access from the page, miner runs in the main process.

## Run / test / build

```sh
npm install
npm start          # run
npm test           # parser + miner checks (runs the real xmrig briefly)
npm run dist       # electron-builder (deb/rpm, nsis, dmg)
```

## Notes

- Use your **public** address only. The app never asks for a seed or private key.
- Antivirus often flags xmrig. If it removes it, restore it and add an exception.
- Best hashrate needs admin/root (MSR tuning). Windows: run as Administrator. Linux: run with root, or accept lower hashrate.
- Solo mining pays only when your machine finds a whole block itself; hashrate alone doesn't predict payouts.

## Roadmap

1. 2.1 standalone miner (this)
2. Node panel (run `safexd` in Docker, sync progress, gate Start Mining on sync)
3. Combined view, auto-start on boot, remote-access status
4. Wallet sync
5. Local explorer

## License

MIT

## Engine note (solo mining)

Solo mode needs xmrig 6.26 or newer. Older xmrig (6.16.2, still bundled for Mac and Windows) asks the node for a block template with `extra_nonce`, which `safexd` rejects with `Internal error: failed to create block template (-5)`; newer xmrig sends `reserve_size`, which works. Linux ships 6.26.0. Mac/Windows builds need the same engine swap before solo mode will work there. xmrig is GPL-3.0 and runs as a separate program next to this MIT app.
