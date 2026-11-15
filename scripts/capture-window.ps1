# Captures a process's top-level window into a PNG.
# Uses PrintWindow(PW_RENDERFULLCONTENT) so the result does not depend on which
# window is foreground or whether another window overlaps it.
# Usage: powershell -File scripts/capture-window.ps1 -ProcessName Typora -Out tmp/x.png [-Width 1500 -Height 1140]
param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 0,
  [int]$Height = 0
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class Nw {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
}
"@

[Nw]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'NO_WINDOW'; exit 1 }

$handle = $proc.MainWindowHandle
Write-Output ("DPISCALE=" + [math]::Round([Nw]::GetDpiForWindow($handle) / 96.0, 3))

[Nw]::ShowWindow($handle, 9) | Out-Null   # SW_RESTORE
if ($Width -gt 0 -and $Height -gt 0) {
  [Nw]::SetWindowPos($handle, [IntPtr]::Zero, 30, 30, $Width, $Height, 0x0040) | Out-Null
}
Start-Sleep -Milliseconds 1800

$rect = New-Object RECT
[Nw]::GetWindowRect($handle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Output ("RECT=" + $rect.Left + "," + $rect.Top + " " + $w + "x" + $h)

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Nw]::PrintWindow($handle, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ("PRINTWINDOW=" + $ok + " SAVED=" + $Out)
