# Safex Community Miner 2.3

One-click Safex (SFX) mining for Windows, Mac and Linux. MIT licensed. Uses the Safex xmrig engine (6.26.0 on Linux, `rx/sfx`).

## What's new in 2.3

- **Network hashrate** next to the logo, estimated from network difficulty (from your node, or the public node if you have none; switch off with `publicFallback` in settings).
- **Rigs tab**: add other miners by address and access token and see each one's status, hashrate, threads, shares and uptime, plus the **combined hashrate for your wallet**. Rigs mining to a different wallet are flagged and left out of the combined total. Any xmrig miner with its HTTP API enabled works. For this app, tick "Share this miner's stats" to get the address and token to paste on the other machine. Use the Tailscale address so it works from anywhere without opening your router.
- **10 second start delay** when "Start mining when app opens" is on, with a visible countdown (`startDelay` in settings; Stop cancels it).
- **Sync detection fixed**: a node that has just restarted reports no network height and no peers, which used to read as "Synced" for a few seconds. A node now only counts as synced when it has peers, is within a block of the network, and has stayed synced for two checks in a row.

## What was new in 2.2

- **Node tab**: run your own `safexd` node from the app, no terminal. One button does the right next step: **Install Docker** (Linux: one password prompt, does the whole install), **Start Docker**, **Fix access**, then **Start node** (first time it builds the node image, then starts it). Shows height, network height, peers and sync %, with a live node log.
- Adopts an existing `safex-node` container, so a node that is already synced is never rebuilt or resynced.
- Safer defaults: node RPC is published on localhost only (only P2P is public), safe database sync, and a 2 minute graceful stop so the chain is never cut off mid-write.
- Optional "Start node when app opens". Combined with the sync gate in solo mode, the app can bring the node up and start mining once it is synced.
- Docker on Mac/Windows can't be installed silently: the button opens the Docker Desktop download page.

## What was new in 2.1

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

1. 2.1 standalone miner (done)
2. Node panel (done, 2.2)
3. Combined view and rigs (done, 2.3), remote-access status
4. Wallet sync
5. Local explorer

## License

MIT

## Engine note (solo mining)

Solo mode needs xmrig 6.26 or newer. Older xmrig (6.16.2, still bundled for Mac and Windows) asks the node for a block template with `extra_nonce`, which `safexd` rejects with `Internal error: failed to create block template (-5)`; newer xmrig sends `reserve_size`, which works. Linux ships 6.26.0. Mac/Windows builds need the same engine swap before solo mode will work there. xmrig is GPL-3.0 and runs as a separate program next to this MIT app.
