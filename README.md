# NexaScreen

Turn a second Windows PC or laptop into an extended-display-style screen for
your main PC — entirely over your local Wi-Fi/LAN. No cloud, no accounts,
no internet connection required.

NexaScreen is a desktop app (Electron + Express + Socket.IO + WebRTC) with
two modes:

- **Host** — runs on the PC whose screen you want to share.
- **Viewer** — runs on the device that receives and displays that screen.

The Host spins up a tiny local signaling server; the actual video stream
travels **peer-to-peer via WebRTC**, so latency stays low and nothing ever
leaves your network.

---

## ✨ Features

- Host / Viewer mode selector with a modern dark UI
- Live screen & window source picker with thumbnails
- Auto-detected local IP address + one-click connection info
- Real-time connected-viewer list with live status
- Full-screen viewer mode, low-latency WebRTC streaming (up to 60 FPS)
- Automatic reconnect on both Host and Viewer if the connection drops
- STUN-assisted ICE negotiation (works great on typical home/office LANs)
- Secure by default: `contextIsolation` on, `nodeIntegration` off, strict
  IPC channel whitelisting, validated Socket.IO payloads
- Auto-update support via `electron-updater` + GitHub Releases
- Ships as a Windows installer **and** a portable `.exe` — no Node.js
  required to run it

---

## 📦 Download (no Node.js required)

1. Go to this repository's **[Releases](../../releases)** page.
2. Download either:
   - `NexaScreen-Setup-<version>.exe` — full installer, or
   - `NexaScreen-Portable-<version>.exe` — single portable executable.
3. Run it. On the Host PC choose **Host**; on the other device choose
   **Viewer**.
4. Make sure both devices are on the **same Wi-Fi/LAN**.
5. On the Host, click **Start Sharing**, pick a screen/window, and note the
   IP address shown.
6. On the Viewer, type that IP address and click **Connect**.

That's it — no sign-up, no server setup, no internet needed.

---

## 🖥️ How it works (architecture)

```
┌──────────────────────────┐        LAN Wi-Fi / Ethernet        ┌───────────────────────────┐
│           HOST            │ ───────────────────────────────►  │          VIEWER            │
│                           │                                     │                           │
│  Electron renderer        │  1. Socket.IO signaling            │  Electron renderer         │
│  (screen capture via      │     (offer / answer / ICE)         │  (RTCPeerConnection,       │
│   desktopCapturer +       │  2. WebRTC peer connection          │   <video> element,         │
│   getUserMedia)           │     established directly            │   fullscreen mode)         │
│                           │  3. Video/audio flows P2P            │                           │
│  Embedded Express +       │     (SRTP over UDP, not              │                           │
│  Socket.IO server          │      through the server)            │                           │
│  (signaling only)          │                                     │                           │
└──────────────────────────┘                                     └───────────────────────────┘
```

The Node/Express + Socket.IO server that runs inside the Host process
**only relays signaling messages** (who wants to connect, WebRTC offers,
answers, ICE candidates). Once negotiated, the actual screen video streams
directly between the two machines using WebRTC — the server is never in the
data path, and everything stays on your LAN (a public STUN server is used
purely to help discover ICE candidates; no relay/TURN server or cloud
storage is involved).

---

## 🗂️ Project structure

```
NexaScreen/
├── electron-main.js        # Main process: windows, IPC, server lifecycle, auto-update
├── preload.js               # Secure contextBridge API surface
├── package.json              # Scripts, dependencies, electron-builder config
├── server/
│   └── server.js             # Express + Socket.IO signaling server
├── extend-mode/
│   ├── driver-manager.js     # Driver install/status via virtual-driver-manager.ps1
│   ├── virtual-monitor-control.js  # Enable/disable the virtual display + set resolution
│   └── display-detector.js   # Diffs screen.getAllDisplays() to find the new virtual screen
├── driver/
│   └── README.md             # What driver + Community Scripts to place here (user-supplied)
├── renderer/
│   ├── common.css            # Shared dark theme design system
│   ├── launcher.html/.css/.js   # Host/Viewer mode selector
│   ├── host.html/.css/.js       # Host UI + capture + WebRTC offer logic
│   ├── viewer.html/.css/.js     # Viewer UI + WebRTC answer logic
│   └── vendor/                  # socket.io-client browser bundle (generated)
├── assets/                   # App icons
├── build/                    # electron-builder resources (icon.ico, icon.png)
├── scripts/
│   └── copy-vendor.js        # Copies socket.io-client bundle into renderer/vendor
└── .github/workflows/build.yml  # CI: builds & publishes Windows exe on Release
```

---

## 🛠️ Installation guide (for developers)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20 LTS recommended)
- Windows, macOS, or Linux for development (production builds target
  Windows x64)

### Setup

```bash
git clone https://github.com/tanvirjahanshakib/lanmirror.git
cd lanmirror
npm install
```

`npm install` automatically runs `scripts/copy-vendor.js` (via
`postinstall`), which copies the Socket.IO client bundle into
`renderer/vendor/` so the Electron windows can load it locally.

### Run in development

```bash
npm start
```

This launches the Electron app directly from source — no build step
needed while developing.

---

## 🏗️ Build guide

### Build a Windows installer + portable exe locally

```bash
npm run dist
```

Output goes to `release/`:

- `NexaScreen-Setup-<version>.exe` (NSIS installer)
- `NexaScreen-Portable-<version>.exe` (portable, no install)

### Publish a release build to GitHub (with auto-update metadata)

```bash
npm run release
```

This requires a `GH_TOKEN` environment variable with a GitHub personal
access token that has `repo` scope, and publishes both artifacts plus the
`latest.yml` metadata file that `electron-updater` needs directly to a
GitHub Release.

> Before building for your own fork, update the `owner`/`repo` fields in the
> `build.publish` section of `package.json`, and the `repository`/`homepage`
> URLs, to match your GitHub username/repository.

---

## 🚀 Continuous delivery via GitHub Actions

`.github/workflows/build.yml` automatically:

1. Triggers whenever you publish a **GitHub Release**.
2. Spins up a `windows-latest` runner.
3. Installs dependencies and runs `npm run release`.
4. Uploads `NexaScreen-Setup-<version>.exe` and
   `NexaScreen-Portable-<version>.exe` directly to that Release's assets.

**To ship a new version:**

```bash
npm version patch   # or minor / major
git push && git push --tags
```

Then create a GitHub Release for the new tag (or let your own tooling do
it) — the workflow picks it up and attaches the Windows binaries
automatically. End users just visit **Releases** and download the `.exe`.

---

## 🔄 Auto Update

NexaScreen uses [`electron-updater`](https://www.electron.build/auto-update)
configured against this repository's GitHub Releases (`build.publish` in
`package.json`). Installed copies check for updates a few seconds after
launch and, once a new release is published, download it in the background
and prompt to restart. The **portable** build does not auto-update (by
design — portable apps are typically re-downloaded manually); the
**installer** build does.

---

## 🖥️➕ Extend Mode (virtual "Screen 2", no HDMI dummy plug)

Extend Mode lets the Host create a **virtual monitor** on Windows and
share *that* instead of a physical window — giving you a real second-
screen experience without a physical HDMI dummy plug. It's driven by
`extend-mode/*.js` in the main process, which controls
[VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)
via its official PowerShell "Community Scripts".

**One-time setup per Host PC:**

1. Install the driver itself — either let NexaScreen do it (Host →
   Extend Mode → "Install Driver") or install it yourself first via:
   ```powershell
   winget install --id=VirtualDrivers.Virtual-Display-Driver -e
   ```
   or the **Virtual Driver Control (VDC)** app it installs. This driver
   is properly code-signed (SignPath.io), so no Windows test-signing
   mode or reboot is needed on typical x64 systems.
2. Download the driver project's
   [Community Scripts](https://github.com/VirtualDrivers/Virtual-Display-Driver/tree/master/Community%20Scripts)
   folder and copy its `.ps1` files into `driver/scripts/` in this
   project — see `driver/README.md` for exactly which files.
3. Launch NexaScreen → Host → **Extend Mode** section: click **⟳** to
   refresh status; if the driver's already installed it'll show "Driver
   Ready" right away.
4. Click **"Enable Extend Mode"**. A virtual "Screen 2" appears (visible
   in Windows Display Settings too), and NexaScreen automatically
   selects it as the share source — click **Start Sharing** as usual.
5. Click **"Disable Extend Mode"** when done (also happens automatically
   on quit).

**Requirements:** Windows 10 (2004+) or Windows 11.

**Why NexaScreen doesn't bundle a driver itself:** writing and signing a
Windows kernel-mode driver from scratch is a separate, multi-week
project outside an Electron app's scope — and an unsigned/self-signed
one would either refuse to load or need test-signing mode enabled.
Driving an existing, properly-signed, actively-maintained driver project
is both safer and far less work to keep working across Windows updates.

---

## 🔒 Security notes

- `contextIsolation: true` and `nodeIntegration: false` in every
  `BrowserWindow`.
- All privileged operations (desktop source listing, server start/stop,
  local IP lookup) go through a **whitelisted** `preload.js` bridge —
  the renderer never touches Node or Electron internals directly.
- The signaling server validates every inbound Socket.IO message's shape
  before relaying it, and only relays to explicit, connected socket IDs.
- The server binds to your LAN and is not exposed to the internet; no
  ports need to be forwarded, no account or credential is created or
  stored.

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| Viewer can't connect | Confirm both devices are on the same Wi-Fi/LAN and the IP shown on the Host matches what you typed. Check Windows Firewall isn't blocking the app on private networks. |
| Black preview on Host | Make sure you selected a source and granted screen-recording permission if prompted by your OS. |
| Choppy video | Try sharing a single window instead of the full desktop, or lower your display resolution — WebRTC will still adapt bitrate automatically. |
| Connection drops repeatedly | Both Host and Viewer auto-reconnect; if it persists, check for Wi-Fi interference or move closer to your router/AP. |

---

## 📄 License

Released under the [MIT License](LICENSE).
