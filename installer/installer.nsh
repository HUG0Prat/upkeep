!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  Var UkDialog
  Var UkDesktopBox
  Var UkDesktop

  Function UkOptionsPage
    StrCpy $0 "Additional options"
    StrCpy $1 "Create a desktop shortcut"
    ${If} $LANGUAGE == 1036
      StrCpy $0 "Options supplémentaires"
      StrCpy $1 "Créer un raccourci sur le Bureau"
    ${ElseIf} $LANGUAGE == 1031
      StrCpy $0 "Zusätzliche Optionen"
      StrCpy $1 "Desktopverknüpfung erstellen"
    ${ElseIf} $LANGUAGE == 1034
      StrCpy $0 "Opciones adicionales"
      StrCpy $1 "Crear un acceso directo en el escritorio"
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "$0" ""
    nsDialogs::Create 1018
    Pop $UkDialog
    ${If} $UkDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 12u "$1"
    Pop $UkDesktopBox
    ${If} $UkDesktop == ""
      StrCpy $UkDesktop ${BST_CHECKED}
    ${EndIf}
    ${NSD_SetState} $UkDesktopBox $UkDesktop

    nsDialogs::Show
  FunctionEnd

  Function UkOptionsLeave
    ${NSD_GetState} $UkDesktopBox $UkDesktop
  FunctionEnd
!endif

!macro customPageAfterChangeDir
  Page custom UkOptionsPage UkOptionsLeave
!macroend

!macro customInstall
  !ifndef BUILD_UNINSTALLER
  ${If} $UkDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}
  !endif
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
