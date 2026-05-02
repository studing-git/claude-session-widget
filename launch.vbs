Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("Process")("ELECTRON_DISABLE_SECURITY_WARNINGS") = "true"
WshShell.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")
WshShell.Run "cmd /c npm start", 0, False
