Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("Process")("ELECTRON_DISABLE_SECURITY_WARNINGS") = "true"
WshShell.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
' git pull 실패(오프라인 등)해도 앱은 그대로 실행되도록 & 로 연결
WshShell.Run "cmd /c git pull --ff-only & npm start", 0, False
