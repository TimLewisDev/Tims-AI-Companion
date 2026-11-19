; Tatty's installer. Build it with tools\build-installer.ps1 (which publishes the exes first).
;   ISCC /DAppVersion=0.22.0 /DRepoDir=<repo> /DOutputDir=<repo>\dist installer\Tatty.iss
;
; It installs for the current user only (no admin rights), puts Tatty's prebuilt exes where
; the plugin looks for them, copies Tatty itself (plugins\tatty, staged into dist\plugin by the
; build script), then runs bootstrap.ps1, which sets up the rest: Git, Python, WebView2, a clone
; of the TT toolbox, and the shortcuts. No LLM tool is needed: the Hub connects one later.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef RepoDir
  #define RepoDir ".."
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

[Setup]
AppId={{6C1F5B0E-7D1A-4B53-9E0B-7A4F7C2E9A11}
AppName=Tatty
AppVersion={#AppVersion}
AppPublisher=Tim Lewis
AppPublisherURL=https://github.com/TimLewisDev/Tims-AI-Companion
DefaultDirName={localappdata}\Programs\Tatty
DefaultGroupName=Tatty
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile={#RepoDir}\plugins\tatty\assets\tatty.ico
UninstallDisplayIcon={app}\tatty.ico
OutputDir={#OutputDir}
OutputBaseFilename=Tatty-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UsedUserAreasWarning=no

[Files]
; where server.py's prebuilt_dir() looks: %LOCALAPPDATA%\Tatty\prebuilt
Source: "{#OutputDir}\prebuilt\TtCompanion.exe"; DestDir: "{localappdata}\Tatty\prebuilt"; Flags: ignoreversion
Source: "{#OutputDir}\prebuilt\Tatty.exe"; DestDir: "{localappdata}\Tatty\prebuilt"; Flags: ignoreversion
Source: "{#OutputDir}\plugin\*"; DestDir: "{localappdata}\Tatty\plugin"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoDir}\installer\bootstrap.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\plugins\tatty\assets\tatty.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Repair: runs the setup again (it skips what is already done)
Name: "{autoprograms}\Repair Tatty"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bootstrap.ps1"""; \
  IconFilename: "{app}\tatty.ico"; Comment: "Run Tatty's setup again"

[InstallDelete]
; an upgrade replaces Tatty's folder whole, so a file a newer version dropped doesn't linger
Type: filesandordirs; Name: "{localappdata}\Tatty\plugin"

[UninstallRun]
Filename: "{localappdata}\Tatty\launcher\bin\Tatty.exe"; Parameters: "--remove-shortcuts"; \
  RunOnceId: "RemoveShortcuts"; Flags: runhidden skipifdoesntexist

[UninstallDelete]
; Tatty's own state (the Hub, projects, chats, your documents) is left alone.
Type: filesandordirs; Name: "{localappdata}\Tatty\plugin"
Type: filesandordirs; Name: "{localappdata}\Tatty\toolbox"
Type: filesandordirs; Name: "{localappdata}\Tatty\prebuilt"
Type: filesandordirs; Name: "{localappdata}\Tatty\launcher"
Type: filesandordirs; Name: "{localappdata}\Tatty\companion"
Type: files; Name: "{localappdata}\Tatty\boot.json"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Args: String;
  Show: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Setting Tatty up (a console window shows the progress)...';
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\bootstrap.ps1') + '"';
    // visible, so a prerequisite's installer can ask for what it needs; waits until it is done.
    // An update from inside Tatty is silent, and so is this.
    if WizardSilent then Show := SW_HIDE else Show := SW_SHOW;
    if not Exec('powershell.exe', Args, '', Show, ewWaitUntilTerminated, Code) then
      MsgBox('Tatty''s files are installed, but its setup could not start: ' + SysErrorMessage(Code) + #13#10 +
        'Run "Repair Tatty" from the Start menu to try again.', mbError, MB_OK)
    else if Code <> 0 then
      MsgBox('Tatty is installed, but some of its setup needs attention.' + #13#10 +
        'Details are in %LOCALAPPDATA%\Tatty\setup.log. Run "Repair Tatty" from the Start menu to try again.',
        mbInformation, MB_OK);
  end;
end;
