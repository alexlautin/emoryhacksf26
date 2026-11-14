Harness watches what AI coding agents do on your computer, follows their subprocesses, and flags risky commands, secret access, and network activity. Everything runs locally.

### Downloads

- **Apple silicon Mac:** `Harness-macos-arm64.dmg`
- **Intel Mac:** `Harness-macos-x64.dmg`
- **Windows 10/11 (64-bit):** `Harness-windows-x64.exe`

Node is included; no separate Node installation is needed. The macOS app lives in the menu bar; the Windows app lives in the system tray. SHA-256 checksums are in `SHA256SUMS.txt`.

### Installation

On macOS, open the DMG and drag Harness to Applications. This build is signed ad hoc and is not notarized, so macOS may require approval in Privacy & Security. If it reports the downloaded app as damaged, run `xattr -cr /Applications/Harness.app` after copying it.

On Windows, run the installer. The installer is not code signed, so Windows SmartScreen may ask you to confirm the publisher. WebView2 is installed by the installer if needed.

### Preview limits

This is an early release. Native installers are built in GitHub Actions; interactive installation and monitoring on personal Windows machines still need broader testing. Windows cannot always determine process working directories, and disabled last-access timestamps limit decoy-read detection. Claude Code hooks need a POSIX shell such as Git Bash. Deep monitoring with eslogger is macOS only and remains experimental.
