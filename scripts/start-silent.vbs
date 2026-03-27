Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
WshShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & rootDir & "\scripts\tray.ps1""", 0, False
