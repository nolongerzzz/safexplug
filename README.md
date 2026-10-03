# Safex Community Miner 2.9

One-click Safex (SFX) mining for Windows, Mac and Linux. MIT licensed. Uses the Safex xmrig engine (6.26.0 on Linux, `rx/sfx`).

## What's new in 3.3.1

- New SAFEX HOMEBASE (Node+Mine edition) app icon. After rebuilding the package it also shows on the full-speed menu entry.

## What's new in 3.3.0

- **The Explorer tab is gone; there is a Wallet button instead.** It jumps to Safex Wallet: if the wallet is already open it is simply brought forward, and if it is closed it starts and asks for your login. The miner stays on the tab you were on. The block explorer now lives in the wallet, which makes the miner and node app lighter. If the wallet is not installed (or on a Mac), the Wallet tab says so.

## What's new in 3.2.1

- Explorer tab: when the miner was started by the full-speed launcher (which runs it as root), it now looks for Safex Wallet in your own home folder and starts the wallet as you, not as root.

## What's new in 3.2.0

- **Explorer tab opens Safex Wallet.** If Safex Wallet is installed in your home folder (`~/safex-wallet`), the Explorer tab starts it on its Explorer. The explorer now lives in the wallet, which reads from your own node. If the wallet is not installed, or on a Mac, the built-in explorer stays exactly as before.

## What's new in 3.1.9

- Explorer: the search box now takes a **transaction hash** (what a send gives you), as well as a block number or block hash. A transaction page shows whether it is still waiting in the pool or which block it is in, with its confirmations, and an "Open its block" button.
- Explorer: a **Waiting in the pool** list shows transactions your node has accepted that are not in a block yet. Read-only, like the rest of the Explorer.

## What's new in 3.1.8

- Mine tab: the status tiles, settings and Start button stay pinned at the top; only the Miner output scrolls underneath. Address and rig name now share one row to save space. On a very short window the tab scrolls as a whole so Start is never hidden.

## What's new in 3.1.7

- **Clearer node addresses.** The share hint lists each address on its own line and says who can use it: "only computers on this same network", "VPN address: works from anywhere the VPN is on", or "public internet address". It used to label every address "Network". Wording now says "checkbox" instead of "switch".

## What's new in 3.1.6

- **Shared node is read-and-mine only.** Turning on "share this node" now starts the node with `--restricted-rpc`. Other computers can read chain info and mine against it, but cannot stop it, ban peers, start its own mining or save its database (checked against a real safexd: with the flag every admin call was refused, without it they all worked). The Node tab says whether the shared node is locked. A node that was shared before 3.1.6 is still open with full control until you turn the switch off and on once (the node restarts once).

## What's new in 3.1.5

- **Solo mode no longer shows shares.** Solo mining has no shares (the miner only submits whole blocks), so the Accepted / Rejected tile is hidden on the Mine tab, and the Rigs tab shows "Blocks (run)" per rig and a "Blocks found (this run)" total instead. Pool mode is unchanged.

## What's new in 3.1.4

- **The rig name box is always visible.** It used to live in the Pool row, which solo mode hides, so solo miners could not find it. It now has its own row ("Rig name") under the address in both modes.

## What's new in 3.1.3

- **Name each rig from its own app.** In solo mode the Miner name box stays editable while mining and the new name reaches the main computer's list (and every other screen) within about 5 seconds. A computer's own row now shows its name ("Ryzen · this machine") instead of just "This machine".

## What's new in 3.1.2

- **Any screen can be the dashboard.** The main computer now answers each report with the whole rig list (itself included), so a Mac or second rig that reports in shows every machine, not just itself. Those rows are read-only there.
- Mac build script no longer needs Homebrew's `libuv` (it needs a docs tool that fails on older macOS); it builds `libuv` directly and gets `cmake` from pip if missing.

## What's new in 3.1.1

- **Mac solo mining fix.** The stock xmrig engine bundled for Mac cannot solo mine against a Safex node ("Invalid block template received from daemon"); Linux uses Safex's patched fork. `tools/build-mac-xmrig.sh` builds the patched engine on the Mac (installs Apple's command line tools and Homebrew packages if missing, applies `tools/xmrig-sfx.patch` to xmrig 6.26.0, builds, installs into the app). Run it once from the app folder, then `npm install` and `npm start`.

## What's new in 3.1.0

- **Rigs report in. No tokens, no addresses.** On your main computer, open the Rigs tab and tick "This is my main computer". Every other copy of the app on the same network finds it automatically and shows up in the list within seconds, mining or stopped, and turns red if it goes quiet. It works the way a pool worker reports to a pool: the rigs send their numbers out, nothing reaches into them.
- Rigs at another location: on that rig, Rigs tab > Advanced > "Report to", type the main computer's address once (e.g. 10.0.0.5:18090).
- Reports are display-only numbers (name, hashrate, shares). They cannot start, stop or change anything. The list remembers rigs between restarts; Remove forgets one.
- The old add-by-address-and-token form and "share stats" are still there under Advanced, for watching a plain xmrig miner.
- Ports used: 18090 (reports, main computer only) and 18091 (UDP announcement). If a firewall asks, allow them on your private network.

## What's new in 3.0.9

- Last Tailscale leftovers (unused display code and styles, a test stub, old README lines) deleted. Nothing in the app depends on or refers to it.

## What's new in 3.0.8

- **Tailscale removed.** No Tailscale code, text or styling remains. Rigs are added by address and token, and the node-sharing switch just shows your network address.

## What's new in 3.0.7

- **Small screens (7-inch panels).** Every tab now scrolls, so nothing is cut off at the bottom. The window can shrink to 480 x 360 and the tab bar tightens up instead of overflowing.

## What's new in 3.0.6

- **Let my other devices use this node.** New switch on the Node tab. Off by default. When on, the node's RPC port (17402) is also reachable from your home network or other devices on your network (the node restarts; chain data is not touched), and the Node tab shows the address to type on the other computer. Use it as the "node address" in My node (solo) mode on a Mac or any other rig. Anyone on that network could reach the RPC port, so only use it on a network you trust. ZMQ stays local.

## What's new in 3.0.5

- **Mac builds now use xmrig 6.26.0** (Intel and Apple Silicon), the same version as Linux, so solo mining works on a Mac. Before, the Mac copy was 6.16.2, which the Safex node rejects.
- **Running on a Mac without building an installer:** install Node.js, unpack the source, then `cd` into it, run `npm install` and `npm start`. If macOS blocks the miner as "unidentified developer", run `xattr -dr com.apple.quarantine .` in that folder once. Node tab (Docker) and the one-click wallet are Linux-only; on a Mac use "Pool" or "My node" pointed at a node you can reach.

## What's new in 3.0.4

- The green progress bar no longer "skips out": when mining is up it fades and the page eases up into the space instead of jumping about 20 px in one frame. The bar also changes colour step by step (amber to green) instead of stretching a gradient.

## What's new in 3.0.3

- Fixed the full-speed launcher: it used `sudo -E`, which the passwordless rule does not allow ("not allowed to preserve the environment"). The rule already keeps the screen variables, so `-E` is gone.

## What's new in 3.0.2

- **Full-speed launcher (Linux).** `tools/install-root-launcher.sh` (run once as your normal user, it asks your password once) sets up a menu entry "Safex Community Miner (full speed)" and login autostart that start the miner with root so CPU tuning (MSR) applies. No terminal, no password prompt afterwards. It also loads the `msr` module at boot and keeps 1280 huge pages. It sets aside any older login entry for the app. The passwordless rule covers only one fixed, root-owned script that takes no arguments.
- The green progress bar now holds each step (node synced, starting, mining) for about a second, so a fast start no longer skips through it.

## What's new in 3.0.1

- The yellow warning banner (huge pages / MSR) now slides in smoothly instead of pushing the page down in one jump.

## What's new in 3.0.0

- **Explorer tab (the last one).** Latest blocks from your own node (public node if yours is off), search by block number or hash, block details with the coinbase, click a transaction for its facts. Blocks paid to your wallet are marked "yours". Light on purpose: it reads from the node live, nothing is indexed or stored.
- **Smoother Mine page.** Fades in instead of snapping, the node chip glows when it reaches synced, and a thin 3-step bar under the status shows: node synced, miner starting, mining.
- **Blocks found** now shows your all-time total from the wallet, with "this run" in small text under it.

## What's new in 2.9.3

- "Remove wallet" is now **Detach wallet** and sits at the right end of the tab bar (shown on the Payments tab once a wallet is attached). It still asks first and only removes this app's view-only copy.

## What's new in 2.9.2

- Payments: the setup box disappears once your wallet is added (a small "Remove wallet" button sits under the payments list).

## What's new in 2.9.1

- Payments: confirmations are computed from your node's height (the wallet tool reported 0 for old payments).

## What's new in 2.9

- **Tab bubbles**: a red glowing bubble on Rigs when any rig is offline or hung (answering but not hashing for 2 minutes); a green glowing bubble on Payments when a new block is found (this rig's block counter, or a new payment in the wallet). It clears when you open Payments.
- **Rigs table**: Now / 1 h / 6 h / 24 h hashrate averages per rig (this machine too), recorded once a minute while mining and kept for 8 days. Threads and total hashes are in the hover tip.
- **24-hour charts** on Payments: combined hashrate (all rigs) and payments per hour.
- Rigs tab explains where a rig's address and access token come from ("Share this miner's stats" on that rig).

## What's new in 2.8

- **24-hour view on Payments**: SFX and payment count for the last 24 hours, plus your average hashrate over the last 24 hours (sampled once a minute while mining, kept across restarts for 8 days) with how many of those hours you were actually mining. Together they give the daily hash/pay picture.

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

- Rigs tab: a green ✓ / red ✗ / amber ! box on every rig, and the Rigs tab itself turns red with a count ("Rigs ✗ 2") when any rig stops answering.

## What's new in 2.6

- **Payments tab**: a rolling tally of payments received since mining began (count, mined blocks, latest, recent list). It reads incoming transfers from `safex-wallet-rpc` running on this computer, so the app never sees seeds or keys. The tally starts at your first mining start; There is no reset button, so the tally is never erased. Start the wallet with `--rpc-bind-ip 127.0.0.1 --disable-rpc-login --daemon-address 127.0.0.1:17402` (its node).

## What's new in 2.5

- **Expected block tile** (Mine tab, Solo mode): average time to find a block at your hashrate and the chance within the next hour. Rigs tab has the same for all rigs combined.
- Fixed a startup race where the node output and network hashrate could be blank for the first moments.

## What's new in 2.4

- **Node output now works**: everything the node printed is replayed when the window opens (before, lines printed during startup were lost), and a status line appears every 30 seconds so a quiet, synced node doesn't look dead.
- **Maintenance** on the Node tab (node must be stopped): **Health check** (reads every block record, read-only), **Back up chain** (full copy into a Docker volume, with a free-space check and automatic cleanup if it fails), **Restore backup** (newest complete backup, with a confirmation), and **Rebuild image** (fetches a fresh node image, chain untouched).
- Maintenance works on the node's **real data volume**, read from the running container, never an assumed name, and never creates an empty volume by mistake. Backup names can't collide.

## What was new in 2.3

- **Network hashrate** next to the logo, estimated from network difficulty (from your node, or the public node if you have none; switch off with `publicFallback` in settings).
- **Rigs tab**: add other miners by address and access token and see each one's status, hashrate, threads, shares and uptime, plus the **combined hashrate for your wallet**. Rigs mining to a different wallet are flagged and left out of the combined total. Any xmrig miner with its HTTP API enabled works. For this app, tick "Share this miner's stats" to get the address and token to paste on the other machine.
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
