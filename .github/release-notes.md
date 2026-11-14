Harness watches what AI coding agents do on your computer, follows their subprocesses, and flags risky commands, secret access, and network activity. Everything runs locally.

### Downloads

- **Apple silicon Mac:** `Harness-macos-arm64.dmg`
- **Intel Mac:** `Harness-macos-x64.dmg`
- **Windows 10/11 (64-bit):** `Harness-windows-x64.exe`

Node is included; no separate Node installation is needed. The macOS app lives in the menu bar; the Windows app lives in the system tray. SHA-256 checksums are in `SHA256SUMS.txt`.

### Installation

#### macOS

This free preview is signed ad hoc, without an Apple Developer ID, and is not notarized by Apple. You do not need a developer account to use it.

1. Choose your DMG. In Apple menu → About This Mac, **Chip** means Apple silicon; **Processor** means Intel.
2. Open the DMG and drag **Harness** to **Applications**. Open it from Applications.
3. If macOS shows **“Harness” Not Opened** and says Apple could not verify it is free of malware, click **Done**.
4. Go to **System Settings → Privacy & Security**, scroll to the message about Harness, and click **Open Anyway**. Authenticate if asked and confirm **Open**.
5. Look for Harness in the **menu bar**. Click its icon to open the dashboard.

Only approve a build you intentionally downloaded from this project's release. macOS saves approval for this copy; a new download may require approval again. If Open Anyway is missing, launch Harness from Applications once more and return to Privacy & Security. On older macOS versions, use **System Preferences → Security & Privacy → General**. Managed Macs may require administrator help. [Apple's first-open guide](https://support.apple.com/102445).

If macOS reports the app as damaged or containing malware, download a fresh copy from this release. If the message persists, [report the exact message and your macOS version](https://github.com/alexlautin/harness/issues). Do not disable Gatekeeper or clear security attributes as a routine installation step.

#### Windows

Run the installer. This preview is unsigned, so SmartScreen may show **Windows protected your PC**. For a build you intentionally downloaded from this project's release, choose **More info → Run anyway** if available. If your organization blocks it or Windows reports malware, stop and check with your administrator or report the exact message. WebView2 is installed if needed. Harness appears in the **system tray**, including its hidden icons menu.

#### Verify your download

Download `SHA256SUMS.txt` from this release. On macOS, run `shasum -a 256` followed by the DMG's path in Terminal. On Windows, run `Get-FileHash` followed by the installer's path in PowerShell. Quote paths containing spaces. Compare the result with the entry for that exact filename. A matching checksum confirms your file matches the release; it does not replace notarization or a malware scan.

### Preview limits

This is an early release. Native installers are built in GitHub Actions; interactive installation and monitoring on personal Windows machines still need broader testing. Windows cannot always determine process working directories, and disabled last-access timestamps limit decoy-read detection. Claude Code hooks need a POSIX shell such as Git Bash. Deep monitoring with eslogger is macOS only and remains experimental.
