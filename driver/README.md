# /driver — Virtual Display Driver files go here

NexaScreen's **Extend Mode** feature (`extend-mode/*.js`) controls a
Windows Indirect Display Driver (IDD) to create a virtual "Screen 2"
without a physical HDMI dummy plug. NexaScreen does **not** ship its own
kernel-mode driver — writing and signing one from scratch is a separate,
multi-week WDK project outside the scope of this app. Instead, it drives
an existing, open-source, already-signed IDD package that you place here
yourself.

## Recommended driver

[virtual-display-rs](https://github.com/MolotovCherry/virtual-display-rs)
by MolotovCherry — supports adding/removing virtual monitors at runtime
via a companion control binary, with no reboot required for that part
(only the one-time driver install + enabling Windows test-signing mode
needs a restart).

Alternatives that work with minor code changes in
`extend-mode/virtual-monitor-control.js` (different CLI flags/IPC):
- [Amyuni usbmmidd_v2](https://www.amyuni.com/forum/viewtopic.php?t=3113)
- [itsmikethetech/Virtual-Display-Driver](https://github.com/itsmikethetech/Virtual-Display-Driver)
- Microsoft's [IddSampleDriver](https://github.com/microsoft/Windows-driver-samples/tree/main/video/IndirectDisplay) (reference/sample only — needs your own signing)

## What to place here

Download the driver project's release and copy these into this folder
(exact filenames depend on which driver you choose — update
`extend-mode/driver-manager.js`'s `INF_NAME` constant and
`extend-mode/virtual-monitor-control.js`'s `CLI_PATH` if they differ):

```
driver/
├── VirtualDisplayDriver.inf   # driver install descriptor
├── VirtualDisplayDriver.cat   # signing catalog
├── VirtualDisplayDriver.sys   # (or .dll, depending on the driver)
└── vdd-ctl.exe                # companion CLI used to add/remove monitors at runtime
```

## Before it will work

1. **Windows test-signing mode** must be enabled (`bcdedit /set testsigning on`
   + reboot) unless you've paid for Microsoft attestation signing —
   NexaScreen's Host UI has a "Set Up Driver" button that walks through
   this.
2. Driver install (`pnputil /add-driver ... /install`) requires one-time
   admin approval (UAC prompt) — also handled by the same button.
3. Requires Windows 10 2004+ or Windows 11 for dynamic IDD (IddCx 1.4).

This folder is intentionally left without binaries in the repository —
you supply them locally (or via your own CI secrets/artifact step) since
driver redistribution licensing varies by project.
