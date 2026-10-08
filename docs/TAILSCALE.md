# Running several rigs with Tailscale

Tailscale is a free private network for your own devices. Each device gets a fixed address that starts with `100.` and every device on your account can reach the others from anywhere: another room, another house, a laptop on a different Wi-Fi. This app does not need Tailscale, and does not talk to it. It simply works over any private network, and Tailscale is the easiest way to get one.

Use this guide if you want one node and one dashboard for several mining computers that are not all on the same home network, or if the automatic rig discovery does not find your other computers.

## The plan

- **One main computer** runs your node (the Node tab) and the dashboard (the Rigs tab).
- **Every other rig** mines against the main computer's node and sends it a small status report.

Nothing on the main computer can be controlled from the other rigs. Reports are display-only numbers (name, hashrate, shares).

## 1. Put every computer on Tailscale

On each computer, including the main one:

1. Install Tailscale from https://tailscale.com/download and sign in to the **same account** on all of them.
2. Find the computer's Tailscale address. On Linux or Mac, run `tailscale ip -4` in a terminal. On Windows, click the Tailscale icon in the tray. It looks like `100.101.102.103`.
3. Write down the main computer's address. The examples below use `100.101.102.103`.

To check that two computers can see each other, run `tailscale ping 100.101.102.103` from a rig.

## 2. Main computer: share the node and collect reports

1. **Node tab:** start your node and let it sync. Tick **Let my other devices use this node**. The node restarts once. The shared node is read-and-mine only, so other computers cannot stop it or change it.
2. **Rigs tab:** tick **This is my main computer: show my other rigs here**.
3. If a firewall asks about ports, allow them on the private network: `17402` (node) and `18090` (rig reports). On Linux with `ufw`: `sudo ufw allow in on tailscale0`.

## 3. Each other rig: mine against the main computer

1. Install the app and open it (see the README, Install).
2. On the **Mine** tab choose **My Node (solo)**. In **Node address** type `100.101.102.103:17402`.
3. Type your **public** wallet address, and give the rig a name in **Rig name**.
4. Open the **Rigs** tab, expand **Advanced**, and in **Report to** type `100.101.102.103:18090`. Automatic discovery only works on one local network, so across Tailscale this box is how a rig finds the main computer.
5. Tick **Wait for synced node** and press Start.

Within a few seconds the rig appears in the main computer's Rigs tab, with its hashrate in the chart.

## Good to know

- Use the same wallet address on every rig and the Rigs tab adds them into one total.
- Only your own Tailscale devices can reach these ports. Do not tick the node-sharing box on a computer that is open to the public internet without Tailscale.
- Tailscale addresses stay the same, so you only set this up once. If the main computer is off, the other rigs cannot mine in solo mode until it is back.
- A Mac or Windows rig works the same way. A Mac cannot run the node itself (the Node tab needs Docker on Linux), so a Mac is always a rig that points at a node elsewhere.
