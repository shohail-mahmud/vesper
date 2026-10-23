; ---------------------------------------------------------------------------
; Vesper NSIS installer hooks
; ---------------------------------------------------------------------------
; Rule: an uninstall leaves nothing of Vesper's own behind, and every install
; after one starts from zero. No library, no playlists, no preferences, no
; cached or custom cover art, no WebView2 profile.
;
; What is NEVER touched: the user's music files, and the original image they
; picked as a cover. Vesper only reads those - when someone assigns a cover it
; copies the image into its own cache folder, and only that copy is removed.
;
; WHY THIS FILE EXISTS (read before changing any path)
; ----------------------------------------------------
; Vesper writes to three places, and they are NOT in the same root:
;
;   %APPDATA%\Vesper\                  Roaming. THE REAL ONE: library.db,
;                                      playlists, EQ + preferences, artwork\.
;                                      This is what dirs::data_dir() resolves to
;                                      on Windows, and what Database::open()
;                                      actually opens.
;
;   %LOCALAPPDATA%\Vesper\             The per-user install directory ($INSTDIR):
;                                      vesper.exe, DLLs, uninstaller. It also
;                                      happens to be named "Vesper", which is a
;                                      trap - see the warning below.
;
;   %LOCALAPPDATA%\dev.vesper.player\  WebView2 profile: the localStorage
;                                      snapshot mirroring library state, cache.
;
; The previous revision of this file deleted only the two %LOCALAPPDATA% paths.
; Those hold the *binaries*, so library.db and artwork\ - sitting in Roaming -
; survived every uninstall, and the next install loaded the whole old collection
; back, covers included. That was the "I uninstalled it and it pulled the cover
; automatically" report.
;
; Tauri's own "delete application data" checkbox does not cover it either: it
; removes %APPDATA%\dev.vesper.player and %LOCALAPPDATA%\dev.vesper.player - the
; bundle-id folders - not the `Vesper` folder the library lives in.
;
; WARNING: $INSTDIR is %LOCALAPPDATA%\Vesper. Never RMDir /r that from the
; install hook - it would delete the app that was just installed. The install
; hook below wipes only %APPDATA%\Vesper and the WebView2 profile.

; --- shared: everything that is Vesper's state, but NOT the install directory --
!macro vesper_wipe_user_data
  ; Library rows, playlists, settings, cached + custom covers.
  RMDir /r "$APPDATA\Vesper"
  ; WebView2 profile: localStorage snapshot, cookies, GPU shader cache.
  RMDir /r "$LOCALAPPDATA\dev.vesper.player"
  RMDir /r "$APPDATA\dev.vesper.player"
!macroend

; --- install ---------------------------------------------------------------
; Runs at the end of the install section, after the running app (if any) has
; been closed. Wiping here is what makes "every install is a fresh install"
; true even when the *old* build's uninstaller is the one that ran first - its
; buggy hook may have left the library in place, this removes it anyway.
; Skipped for an in-place update (setup.exe /UPDATE), which is meant to keep
; the library.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode = 1
    Goto vesper_install_done
  ${EndIf}

  !insertmacro vesper_wipe_user_data

  vesper_install_done:
!macroend

; --- uninstall -------------------------------------------------------------
; Last thing to run, after NSIS has removed the installed files, so only user
; data can be left. No prompt: uninstall means nothing survives. Skipped for an
; in-place update (/UPDATE), which keeps the library on purpose.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode = 1
    Goto vesper_uninstall_done
  ${EndIf}

  !insertmacro vesper_wipe_user_data

  ; Removes the install folder only if it is now empty. Non-recursive on
  ; purpose: by this point NSIS has already deleted everything it installed.
  RMDir "$LOCALAPPDATA\Vesper"

  vesper_uninstall_done:
!macroend
