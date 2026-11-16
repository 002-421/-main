# Synthetic clipboard acceptance: paste into the Notepad process started here.
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class XrsNotepad {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string title);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
}
'@
$owned = Start-Process -FilePath notepad.exe -PassThru
try {
 if (-not $owned.WaitForInputIdle(10000)) { throw 'Synthetic Notepad did not initialize.' }
 $edit = [IntPtr]::Zero
 for ($i=0; $i -lt 50; $i++) {
  $owned.Refresh()
  $edit = [XrsNotepad]::FindWindowEx($owned.MainWindowHandle,[IntPtr]::Zero,'Edit',$null)
  if ($edit -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
 }
 if ($edit -eq [IntPtr]::Zero) { throw 'Synthetic Notepad edit control is unavailable.' }
 [void][XrsNotepad]::SendMessage($edit,0x0302,[IntPtr]::Zero,[IntPtr]::Zero)
 $length = [XrsNotepad]::SendMessage($edit,0x000E,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()
 $buffer = New-Object Text.StringBuilder ($length+1)
 [void][XrsNotepad]::SendMessage($edit,0x000D,[IntPtr]($length+1),$buffer)
 [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($buffer.ToString())))
} finally {
 # Kill only the process launched by this test, without touching other windows.
 if (-not $owned.HasExited) { $owned.Kill(); [void]$owned.WaitForExit(5000) }
}
