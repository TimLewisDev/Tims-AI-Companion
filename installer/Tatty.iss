; Tatty's installer. Build it with tools\build-installer.ps1 (which publishes the exes first).
;   ISCC /DAppVersion=0.22.0 /DRepoDir=<repo> /DOutputDir=<repo>\dist installer\Tatty.iss
;
; It installs for the current user only (no admin rights), puts Tatty's prebuilt exes where
; the plugin looks for them, then runs bootstrap.ps1, which sets up what Tatty needs:
; Git, Python, WebView2, the LLM tools, the toolbox and Tatty plugins, shortcuts, first project.

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
Source: "{#RepoDir}\installer\bootstrap.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\plugins\tatty\assets\tatty.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Repair: runs the setup again (it skips what is already done)
Name: "{autoprograms}\Repair Tatty"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bootstrap.ps1"""; \
  IconFilename: "{app}\tatty.ico"; Comment: "Run Tatty's setup again"

[UninstallRun]
Filename: "{localappdata}\Tatty\launcher\bin\Tatty.exe"; Parameters: "--remove-shortcuts"; \
  RunOnceId: "RemoveShortcuts"; Flags: runhidden skipifdoesntexist

[UninstallDelete]
; Tatty's own state (the Hub, projects, chats, your documents) is left alone.
Type: filesandordirs; Name: "{localappdata}\Tatty\prebuilt"
Type: filesandordirs; Name: "{localappdata}\Tatty\launcher"
Type: filesandordirs; Name: "{localappdata}\Tatty\companion"
Type: files; Name: "{localappdata}\Tatty\boot.json"

[Code]
var
  LlmPage: TInputOptionWizardPage;
  DisciplinePage: TInputOptionWizardPage;
  ProjectPage: TInputQueryWizardPage;

function Quote(const S: String): String;
begin
  Result := '"' + S + '"';
end;

function ListOf(Page: TInputOptionWizardPage; const Names: array of String): String;
var
  I: Integer;
begin
  Result := '';
  for I := 0 to High(Names) do
    if Page.Values[I] then
    begin
      if Result <> '' then Result := Result + ',';
      Result := Result + Names[I];
    end;
end;

procedure InitializeWizard;
begin
  LlmPage := CreateInputOptionPage(wpSelectDir, 'Your LLM',
    'Which tools should Tatty work with?',
    'Tatty drives the workflow through Claude Code. GitHub Copilot CLI can also be linked to the toolbox. ' +
    'Anything not installed yet is installed for you, and you sign in once.',
    False, False);
  LlmPage.Add('Claude Code (needed for the toolbox and Tatty plugins)');
  LlmPage.Add('GitHub Copilot CLI');
  LlmPage.Values[0] := True;
  LlmPage.Values[1] := False;

  DisciplinePage := CreateInputOptionPage(LlmPage.ID, 'The TT toolbox',
    'Which parts of the toolbox do you use?',
    'The core plugin is always installed.', False, False);
  DisciplinePage.Add('Engineering');
  DisciplinePage.Add('Design');
  DisciplinePage.Add('Production');
  DisciplinePage.Values[0] := True;

  ProjectPage := CreateInputQueryPage(DisciplinePage.ID, 'Your first project',
    'Tatty keeps each project''s features, designs and tasks in a folder of its own.',
    'Leave the name empty to make the first project later, in the Hub.');
  ProjectPage.Add('Project name:', False);
  ProjectPage.Add('Tatty folder (empty: Tatty\<name> in your user folder):', False);
  ProjectPage.Add('Code repository folder (optional):', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = LlmPage.ID then
  begin
    if not (LlmPage.Values[0] or LlmPage.Values[1]) then
    begin
      MsgBox('Choose at least one LLM tool.', mbInformation, MB_OK);
      Result := False;
    end;
  end;
end;

function SetupArguments: String;
var
  Llm: String;
begin
  Llm := ListOf(LlmPage, ['claude', 'copilot']);
  // Claude Code hosts the plugins, so it is installed even when only Copilot was ticked.
  Result := '-NoProfile -ExecutionPolicy Bypass -File ' + Quote(ExpandConstant('{app}\bootstrap.ps1')) +
    ' -Llm ' + Quote(Llm) +
    ' -Disciplines ' + Quote(ListOf(DisciplinePage, ['engineering', 'design', 'production']));
  if Trim(ProjectPage.Values[0]) <> '' then
    Result := Result + ' -ProjectName ' + Quote(Trim(ProjectPage.Values[0]));
  if Trim(ProjectPage.Values[1]) <> '' then
    Result := Result + ' -ProjectRoot ' + Quote(Trim(ProjectPage.Values[1]));
  if Trim(ProjectPage.Values[2]) <> '' then
    Result := Result + ' -ProjectRepo ' + Quote(Trim(ProjectPage.Values[2]));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Setting Tatty up (a console window shows the progress and the sign-in)...';
    // visible, so the sign-in prompts can be answered; waits until it is done
    if not Exec('powershell.exe', SetupArguments, '', SW_SHOW, ewWaitUntilTerminated, Code) then
      MsgBox('Tatty''s files are installed, but its setup could not start: ' + SysErrorMessage(Code) + #13#10 +
        'Run "Repair Tatty" from the Start menu to try again.', mbError, MB_OK)
    else if Code <> 0 then
      MsgBox('Tatty is installed, but some of its setup needs attention.' + #13#10 +
        'Details are in %LOCALAPPDATA%\Tatty\setup.log. Run "Repair Tatty" from the Start menu to try again.',
        mbInformation, MB_OK);
  end;
end;
