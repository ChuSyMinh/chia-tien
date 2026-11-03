' Chay server an (khong hien cua so) - dung cho tu khoi dong cung Windows
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\start.bat"" > """ & dir & "\data\server.log"" 2>&1", 0, False
