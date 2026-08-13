' Windows: launch the search shim with no console window.
'
' pythonw.exe is the windowless Python host; WScript.Shell.Run with a window
' style of 0 keeps the launcher itself invisible too, so nothing flashes on the
' desktop at logon.
'
' Paths resolve relative to THIS FILE, so the repo can live anywhere. It
' expects a venv beside it: shim\venv\Scripts\pythonw.exe
'
' To run at logon, put a shortcut to this file in your Startup folder:
'   Win+R -> shell:startup

Dim fso, shell, here, pythonw, server
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = fso.BuildPath(here, "venv\Scripts\pythonw.exe")
server = fso.BuildPath(here, "server.py")

If Not fso.FileExists(pythonw) Then
    MsgBox "No venv found at:" & vbCrLf & pythonw & vbCrLf & vbCrLf & _
           "Create it first:" & vbCrLf & _
           "  python -m venv venv" & vbCrLf & _
           "  venv\Scripts\python.exe -m pip install -r requirements.txt", _
           vbExclamation, "DeepSeek Harness Web Tools search shim"
    WScript.Quit 1
End If

shell.Run """" & pythonw & """ """ & server & """", 0, False
