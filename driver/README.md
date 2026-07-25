# /driver — Virtual Display Driver setup

NexaScreen's **Extend Mode** feature (`extend-mode/*.js`) controls
[VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)
to create a virtual "Screen 2" without a physical HDMI dummy plug.
NexaScreen does **not** ship its own kernel-mode driver — it drives this
existing, open-source, properly code-signed (SignPath.io) IDD project.

## How control actually works (important — read this)

This driver does **not** expose a generic CLI with `add`/`remove` monitor
commands. It's controlled through its official **Community Scripts**
PowerShell collection — a single virtual display device that you
enable/disable (not multiple independently-addressed monitors). NexaScreen
calls these scripts via `powershell.exe -File ...`.

## What to place here

1. Get the scripts from the driver's GitHub repo:
   ```
   https://github.com/VirtualDrivers/Virtual-Display-Driver/tree/master/Community%20Scripts
   ```
   Download (or `git clone` and copy) that folder's contents.

2. Copy at least these three files into `driver/scripts/` in this
   project:
   ```
   driver/scripts/
   ├── virtual-driver-manager.ps1   # install / uninstall / status / enable / disable
   ├── toggle-VDD.ps1                # quick enable/disable toggle (optional, not required by NexaScreen)
   └── changeres-VDD.ps1             # sets virtual display resolution (used automatically by Extend Mode)
   ```

3. `virtual-driver-manager.ps1` may depend on the **DisplayConfig** and
   **MonitorConfig** PowerShell modules for some actions. If Extend Mode
   fails with a module-not-found error, run the driver project's
   `set-dependencies.ps1` once (as admin) on the Host PC to install them:
   ```powershell
   Install-Module -Name DisplayConfig -RequiredVersion 1.1.1 -Force
   Install-Module -Name MonitorConfig -RequiredVersion 1.0.3 -Force
   ```

## Already installed the driver manually (e.g. via the VDC app)?

That's fine and expected — many people install the driver once via the
**Virtual Driver Control (VDC)** desktop app (or `winget install
--id=VirtualDrivers.Virtual-Display-Driver -e`) before ever touching
NexaScreen. NexaScreen's "Set Up Driver" button in Host mode detects
whether the driver is already installed (via `virtual-driver-manager.ps1
-Action status -Json`) and will just show "Driver Ready" if so — click
the **⟳ refresh** button next to it if the status looks stale.

## Before Extend Mode will work

1. The scripts above must be present in `driver/scripts/`.
2. The driver itself must be installed (either by NexaScreen's "Install
   Driver" button, or manually via the VDC app / winget — both are fine).
3. Windows 10 2004+ or Windows 11.
4. Test-signing mode is **not required** for typical x64 systems with
   this driver (it's properly signed). Only some ARM64 + Windows 11
   24H2+ configurations may need it — see the driver project's own docs
   if that applies to your setup.

## Why this folder ships empty

Driver/script redistribution and versioning is the upstream project's
call, not NexaScreen's — you fetch the current release/scripts yourself
so you always get the latest signed build rather than a copy that could
go stale or fall out of sync with what Windows will actually trust.
