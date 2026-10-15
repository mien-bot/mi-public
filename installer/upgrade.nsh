; Only an actual NSIS installation may register itself for Windows startup.
; This marker is deliberately absent from win-unpacked release/test builds.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\mi-installed" w
  FileWrite $0 "${VERSION}"
  FileClose $0

  ; Repair the existing Electron login entry, including entries pointing at
  ; old win-unpacked builds. Preserve an absent entry and StartupApproved state
  ; so upgrading does not turn a user's disabled startup preference back on.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Mi"
  ${If} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Mi" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${EndIf}
!macroend
