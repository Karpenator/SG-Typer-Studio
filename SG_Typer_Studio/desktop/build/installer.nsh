; SG Typer Studio joins "Open with" for PSD and PSB files. It never takes the double-click away
; from Photoshop: a typesetter who wants that sets it in Windows.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\SGTyperStudio.psd" "" "Photoshop Document"
  WriteRegStr HKCU "Software\Classes\SGTyperStudio.psd\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\SGTyperStudio.psd\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\.psd\OpenWithProgids" "SGTyperStudio.psd" ""
  WriteRegStr HKCU "Software\Classes\.psb\OpenWithProgids" "SGTyperStudio.psd" ""

  ; Replace the previous product's optional file association.
  DeleteRegValue HKCU "Software\Classes\.psd\OpenWithProgids" "TypeRStudio.psd"
  DeleteRegValue HKCU "Software\Classes\.psb\OpenWithProgids" "TypeRStudio.psd"
  DeleteRegKey HKCU "Software\Classes\TypeRStudio.psd"

  ; New application links, plus the legacy link understood by TypeR for Photoshop.
  WriteRegStr HKCU "Software\Classes\sg-typer-studio" "" "URL:SG Typer Studio"
  WriteRegStr HKCU "Software\Classes\sg-typer-studio" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\sg-typer-studio\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\typer-studio" "" "URL:SG Typer Studio"
  WriteRegStr HKCU "Software\Classes\typer-studio" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\typer-studio\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\sg-typer-studio"
  DeleteRegKey HKCU "Software\Classes\typer-studio"
  DeleteRegValue HKCU "Software\Classes\.psd\OpenWithProgids" "SGTyperStudio.psd"
  DeleteRegValue HKCU "Software\Classes\.psb\OpenWithProgids" "SGTyperStudio.psd"
  DeleteRegKey HKCU "Software\Classes\SGTyperStudio.psd"
  ; Remove only the old updater's cache; user documents and settings are retained.
  RMDir /r "$LOCALAPPDATA\typer-studio-updater"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
