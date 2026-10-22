; ---------------------------------------------------------------------------
; Vesper NSIS installer hooks
; ---------------------------------------------------------------------------
; A per-user install puts the app in %LOCALAPPDATA%\Vesper - which is ALSO the
; folder Vesper keeps library.db and cached artwork in. NSIS only removes the
; files it installed, so without this hook the library survived an uninstall and
; the whole collection reappeared on the next install. That was real user
; confusion: "I imported one file and my old library came back".
;
; POSTUNINSTALL is the last thing to run, so by now the app files are gone and
; only user data can be left in the folder.
!macro NSIS_HOOK_POSTUNINSTALL
  ; Never touch data during a silent/unattended uninstall - only ask when a human
  ; is actually running the uninstaller.
  ${If} ${Silent}
    Goto vesper_keep_data
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Also delete your Vesper library, playlists, custom covers and cached artwork?$\r$\n$\r$\nYour music files on disk are NOT touched - only Vesper's own database and thumbnails." \
    IDNO vesper_keep_data

  Delete "$LOCALAPPDATA\Vesper\library.db"
  Delete "$LOCALAPPDATA\Vesper\library.db-wal"
  Delete "$LOCALAPPDATA\Vesper\library.db-shm"
  RMDir /r "$LOCALAPPDATA\Vesper\artwork"
  ; WebView2 profile: cache, storage, GPU shaders (safe to remove, rebuilt on start)
  RMDir /r "$LOCALAPPDATA\dev.vesper.player"

  vesper_keep_data:
  ; Removes the folder only if it is now empty; never recurses at this point.
  RMDir "$LOCALAPPDATA\Vesper"
!macroend
