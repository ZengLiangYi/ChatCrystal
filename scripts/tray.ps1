param(
    [string]$RootDir = (Split-Path -Parent $PSScriptRoot),
    [int]$Port = 3721
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Enable DPI awareness
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class DpiAware {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiAware]::SetProcessDPIAware() | Out-Null

# Hide PowerShell console window
Add-Type -Name Win32 -Namespace Native -MemberDefinition @"
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
"@
$consolePtr = [Native.Win32]::GetConsoleWindow()
[Native.Win32]::ShowWindow($consolePtr, 0) | Out-Null

# Create diamond icon
$bmp = New-Object System.Drawing.Bitmap(16, 16)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(15, 17, 23))
$points = @(
    [System.Drawing.Point]::new(8, 1),
    [System.Drawing.Point]::new(14, 7),
    [System.Drawing.Point]::new(8, 14),
    [System.Drawing.Point]::new(2, 7)
)
$g.FillPolygon([System.Drawing.Brushes]::Goldenrod, $points)
$g.DrawPolygon([System.Drawing.Pens]::DarkGoldenrod, $points)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

# Server process management
$script:serverProcess = $null
$script:isRunning = $false
$tsxPath = Join-Path $RootDir "node_modules\tsx\dist\cli.mjs"
$serverEntry = Join-Path $RootDir "server\src\index.ts"
$url = "http://localhost:$Port"

function Start-Server {
    if ($script:serverProcess -and !$script:serverProcess.HasExited) { return }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "`"$tsxPath`" `"$serverEntry`""
    $psi.WorkingDirectory = $RootDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.EnvironmentVariables["NODE_ENV"] = "production"
    $script:serverProcess = [System.Diagnostics.Process]::Start($psi)
    $script:isRunning = $true
    Update-Menu
}

function Stop-Server {
    if ($script:serverProcess -and !$script:serverProcess.HasExited) {
        $script:serverProcess.Kill()
        $script:serverProcess.WaitForExit(3000)
    }
    $script:serverProcess = $null
    $script:isRunning = $false
    Update-Menu
}

function Update-Menu {
    if ($script:isRunning) {
        $notifyIcon.Text = "ChatCrystal - Running"
        $startItem.Visible = $false
        $stopItem.Visible = $true
    } else {
        $notifyIcon.Text = "ChatCrystal - Stopped"
        $startItem.Visible = $true
        $stopItem.Visible = $false
    }
}

$taskName = "ChatCrystal"
function Get-AutoStart {
    try { schtasks /Query /TN $taskName 2>$null | Out-Null; return $true }
    catch { return $false }
}
function Toggle-AutoStart {
    if (Get-AutoStart) {
        schtasks /Delete /TN $taskName /F 2>$null
        $autoStartItem.Checked = $false
    } else {
        $vbsPath = Join-Path $RootDir "scripts\start-silent.vbs"
        schtasks /Create /SC ONLOGON /TN $taskName /TR "wscript.exe `"$vbsPath`"" /RL HIGHEST /F 2>$null
        $autoStartItem.Checked = $true
    }
}

# Tray icon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Visible = $true
$notifyIcon.Text = "ChatCrystal"

# Context menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$titleItem = $contextMenu.Items.Add("ChatCrystal")
$titleItem.Enabled = $false
$titleItem.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$contextMenu.Items.Add("-") | Out-Null
$openItem = $contextMenu.Items.Add("Open Browser")
$openItem.Add_Click({ Start-Process $url }.GetNewClosure())
$contextMenu.Items.Add("-") | Out-Null
$startItem = $contextMenu.Items.Add("Start Server")
$startItem.Add_Click({ Start-Server })
$stopItem = $contextMenu.Items.Add("Stop Server")
$stopItem.Add_Click({ Stop-Server })
$contextMenu.Items.Add("-") | Out-Null
$autoStartItem = $contextMenu.Items.Add("Auto Start")
$autoStartItem.Checked = Get-AutoStart
$autoStartItem.Add_Click({ Toggle-AutoStart })
$contextMenu.Items.Add("-") | Out-Null
$exitItem = $contextMenu.Items.Add("Exit")
$exitItem.Add_Click({
    Stop-Server
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})
$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Add_DoubleClick({ Start-Process $url }.GetNewClosure())

# Auto-restart monitor
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if ($script:isRunning -and $script:serverProcess -and $script:serverProcess.HasExited) {
        $script:isRunning = $false
        Start-Server
    }
})
$timer.Start()

Start-Server
[System.Windows.Forms.Application]::Run()
