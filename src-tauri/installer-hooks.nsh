; Runs when Harness is uninstalled from Windows Settings > Apps (or its uninstaller).
; The app's own "Uninstall Harness…" menu does the same cleanup before it launches this uninstaller.

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop a running Harness (/T also ends the Node server it started), so its files can be deleted.
  ; Not killing node.exe by name: that would also end your other Node programs.
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  nsExec::Exec 'taskkill /F /T /IM "harness.exe"'
  Sleep 1000

  ; Take Harness's Claude Code hooks out of every protected folder. Left behind, they would
  ; block Claude Code there. Skipped quietly if the bundled Node or script isn't where expected.
  IfFileExists "$INSTDIR\node.exe" 0 hooks_done
  IfFileExists "$INSTDIR\app\src\uninstall.js" 0 hooks_done
  nsExec::Exec '"$INSTDIR\node.exe" "$INSTDIR\app\src\uninstall.js" --quiet'
  Pop $0
  StrCmp $0 "0" hooks_done
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "Harness could not remove its Claude Code hooks from every protected folder. If you uninstall now, Claude Code may stay blocked in those folders.$\r$\n$\r$\nUninstall anyway?" IDYES hooks_done
  Abort
  hooks_done:

  ; "Open at login" is a Run registry entry.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Harness"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "harness"
!macroend
