# Safex Community Miner 2.7

One-click Safex (SFX) mining for Windows, Mac and Linux. MIT licensed. Uses the Safex xmrig engine (6.26.0 on Linux, `rx/sfx`).

## What's new in 2.7.6

- Payments now counts **everything the view-only wallet has found** (it only scans from the block you chose at setup, which is the start of the tally: "everything found since block N"). Payments from before an old tally reset reappear; nothing can be hidden by a start date anymore.

## What's new in 2.7.5

- Payments: the wallet-tool address box is gone on Linux (the app handles it). Only your public address and private view key are ever entered, and the view key only in the wallet tool's own window. The box appears only on systems without one-click setup.

## What's new in 2.7.4

- Removed the "Restart count" button from Payments; the tally can no longer be reset by accident.

## What's new in 2.7.3

- Payments: with the app-managed wallet the address is set automatically (127.0.0.1:18082, the wallet tool) and the manual box is hidden. If you point it at your node (17402) by mistake it now says so instead of "Method not found".

## What's new in 2.7.2

- Payments list shows the block height of each payment so you can check it against a block explorer or your other wallet.

## What's new in 2.7.1

- **Blocks found now counts in solo mode.** xmrig never prints a "BLOCK FOUND" line (the old counter waited for text that never comes), so it stayed at 0. In solo mode the node only accepts results that meet network difficulty, so each new accepted result at that difficulty is a block. Donation-period shares are ignored. The tile counts since mining last started; your full history is the Payments tab.

## What's new in 2.7

- **Payments tab can set up its own view-only wallet (Linux)**: "Download wallet tools" fetches the official safexcore 7.0.3 `safex-wallet-cli` / `safex-wallet-rpc` and verifies them against the release SHA256SUMS. "Add my wallet" opens the wallet tool's own terminal window where you paste your address and private view key once (the app never sees them; seed and spend key are never needed). The app then runs `safex-wallet-rpc` on 127.0.0.1 against your node and fills in the Payments address by itself.
- Note: `--restricted-rpc` is NOT used because it blocks `get_transfers`; the wallet is view-only, so it cannot spend either way.

## What's new in 2.6.2

- Status tile reads "Starting…" during the start delay (hover for the seconds left) so it no longer spills out of its box.
- Payments hint now includes `--daemon-address 127.0.0.1:17402` so the wallet reads from your own node.

## What's new in 2.6.1

- Rigs tab: a green ✓ / red ✗ / amber ! box on every rig, and the Rigs tab itself turns red with a count ("Rigs ✗ 2") when any rig stops answering. The Tailscale line stays underneath as a hint about *why*.

## What's new in 2.6

- **Payments tab**: a rolling tally of payments received since mining began (count, mined blocks, latest, recent list). It reads incoming transfers from `safex-wallet-rpc` running on this computer, so the app never sees seeds or keys. The tally starts at your first mining start; There is no reset button, so the tally is never erased. Start the wallet with `--rpc-bind-ip 127.0.0.1 --disable-rpc-login --daemon-address 127.0.0.1:17402` (its node).

## What's new in 2.5

- **Expected block tile** (Mine tab, Solo mode): average time to find a block at your hashrate and the chance within the next hour. Rigs tab has the same for all rigs combined.
- **Tailscale line on every rig**: online and answering, machine up but miner silent, machine offline (last seen), or not on Tailscale. Read-only; the app never changes Tailscale.
- Fixed a startup race where the node output and network hashrate could be blank for the first moments.

## What's new in 2.4

- **Node output now works**: everything the node printed is replayed when the window opens (before, lines printed during startup were lost), and a status line appears every 30 seconds so a quiet, synced node doesn't look dead.
- **Maintenance** on the Node tab (node must be stopped): **Health check** (reads every block record, read-only), **Back up chain** (full copy into a Docker volume, with a free-space check and automatic cleanup if it fails), **Restore backup** (newest complete backup, with a confirmation), and **Rebuild image** (fetches a fresh node image, chain untouched).
- Maintenance works on the node's **real data volume**, read from the running container, never an assumed name, and never creates an empty volume by mistake. Backup names can't collide.

## What was new in 2.3

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
