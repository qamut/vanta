; Ganchos do instalador do VANTA.
; A desinstalação remove apenas o que o próprio VANTA registrou no HKCU.
; Dados do usuário em %APPDATA% só saem se a caixa "apagar dados" for marcada.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\app.vanta.bridge"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\app.vanta.bridge"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\app.vanta.bridge"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\app.vanta.bridge"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VANTA"
!macroend
