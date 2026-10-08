# SAFEX SOLO-SYNC Node+Mine

One app to run your own Safex (SFX) node and mine against it, with your payments, your other rigs and your wallet one click away. Windows, Mac and Linux. MIT licensed.

- **Mine** solo against your own node, or join a pool. Live hashrate, status light and warnings that tell you when a setting is costing you speed.
- **Node** runs `safexd` for you from the app, with no terminal (Linux, uses Docker). One button does the next step.
- **Rigs** shows every mining computer you own in one list and one chart, wherever they are.
- **Payments** shows what has been paid to your address, using the official Safex wallet tool in view-only mode. It can see payments but can never spend.

The app asks only for your **public** address. It never asks for a seed or a private key. The only key it ever asks for is the view key, which cannot spend, and only when you set up Payments.

## Why this exists

Mining Safex has had a rocky history. Earlier miners, SFXOS among them, ran into problems, and xmrig proved to be the more dependable engine to build on. This app takes that engine and adds the things people used to rely on a pool page for: live hashrate, per-rig status, found blocks and payments. Together with the option to run your own node from the same window, it is a complete mining setup in one app, and you do not have to depend on anyone else's website to see how your mining is doing.

## Install

You need a few hundred MB of free disk space for the app, plus more later if you run your own node (the chain keeps growing).

### Step 1: get the app (every system)

1. Open this link in your browser. It downloads a zip file:
   https://github.com/nolongerzzz/safexplug/archive/refs/heads/solo-sync-node-mine.zip
2. Open your Downloads folder and unzip it (double-click on Mac and Windows, right-click and Extract on Linux). You get a folder named `safexplug-solo-sync-node-mine`.
3. Move that folder to your home folder (optional but tidy). This is the "app folder" below. Keep it there, because the app runs from it.

### Step 2: install

#### Linux (Ubuntu, Debian, Mint)

1. Open the app folder, right-click an empty spot and choose **Open in Terminal**. (Or open a terminal and type `cd ~/safexplug-solo-sync-node-mine`.)
2. Run:

   ```sh
   bash install.sh
   ```

   It installs Node.js if needed (it may ask for your password), sets the app up, and offers a menu entry that starts the miner at full CPU speed. Say yes.
3. Open **SAFEX SOLO-SYNC Node+Mine (full speed)** from your menu, or run `npm start` in the app folder.

#### Mac

1. Open **Terminal** (Spotlight, then type Terminal) and type `cd ~/safexplug-solo-sync-node-mine`, adjusting the path if you put the folder elsewhere.
2. Run `bash install.sh`. If Node.js is missing it will tell you to install it from https://nodejs.org (the LTS button), or it installs it for you when Homebrew is present. Run `bash install.sh` again after that.
3. Start the app with `npm start`.

If macOS says the miner is from an "unidentified developer", run `xattr -dr com.apple.quarantine .` once in the app folder. The install script already does this.

A Mac mines against a node running elsewhere (see Several rigs). The Node tab needs Docker on Linux.

#### Windows

1. Install Node.js from https://nodejs.org (the LTS button) and finish its installer.
2. Open the app folder and double-click `tools\start-windows.cmd`. It asks for administrator rights once (the miner needs them for its speed boost) and installs the rest on the first run.

Antivirus programs often flag mining engines. If yours removes the engine, restore it and add an exception for the app folder.

## First run

1. **Your address.** On the **Mine** tab paste your public Safex address.
2. **Your node (Linux).** Open the **Node** tab and press the big button. It walks through installing Docker, starting it, and starting the node. The node downloads about 100 MB and then syncs the whole chain, which takes a long while. You can use the app while it syncs.
3. **Pick a mode.** On Mine choose **My Node (solo)** to mine against your own node, or **Pool**. Tick **Wait for synced node** so mining starts by itself when the node has caught up.
4. **Start.** Press Start. The status strip shows hashrate and the node chip shows Synced when ready. Tick **Start mining when app opens** if you want it to run every time.
5. **Payments (optional).** Open **Payments** and follow the numbered steps. You paste your address and view key once, into the wallet tool in a terminal window the app opens. The view key can only look at payments, never spend.

Solo mining pays only when your machine finds a whole block itself. Hashrate alone does not predict payouts, and the Mine tab shows how long a block is expected to take at your speed.

## Several rigs

Run the app on every computer. Put your node and dashboard on one main computer and point the others at it.

- **All computers on the same home network:** on the main computer tick **Let my other devices use this node** (Node tab) and **This is my main computer** (Rigs tab). On each other rig choose My Node (solo) and enter the node address shown on the Node tab. Rigs find the main computer by themselves.
- **Computers in different places:** use Tailscale, a free private network for your own devices. Step by step in [docs/TAILSCALE.md](docs/TAILSCALE.md).

## Updating

Download `safex-miner-<version>-update.tar.xz` into your Downloads folder. An **Update to <version>** button appears in the header (on a Mac, press **Check for update**). Click it twice, once to start and once to confirm. The app unpacks the update over its own folder, keeps a backup of what it replaced, and restarts.

## If something is not right

- **Low hashrate.** Run the full-speed menu entry on Linux or run as Administrator on Windows. The Mine tab warns when CPU tuning or huge pages did not apply.
- **Solo mining says the block template is invalid or refused.** Solo needs the Safex engine that ships with the app (xmrig 6.26 or newer). Do not replace it with a stock xmrig.
- **Node tab cannot start.** It needs Docker. The big button installs and starts it. Docker is Linux-only in this app.
- **A rig does not show up on the main computer.** Discovery works on one local network only. Across networks type the main computer's address into Rigs, Advanced, **Report to** (see docs/TAILSCALE.md).
- **Windows ports.** If a firewall asks, allow ports 17402 (node), 18090 (rig reports) and 18091 (rig discovery) on your private network only.

## Developing

```sh
npm install
npm start          # run the app
npm test           # unit checks (runs the real engine briefly)
npm run dist       # build a package (deb, installer, dmg)
```

## Good to know

- Best hashrate needs admin/root (CPU tuning). Windows: run as Administrator. Linux: use the full-speed menu entry.
- Antivirus often flags mining engines. If yours removes it, restore it and add an exception.

## License

MIT
