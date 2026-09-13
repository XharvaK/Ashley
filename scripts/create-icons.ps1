$iconsDir = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
Add-Type -AssemblyName System.Drawing

function New-AvatarIcon($size, $path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $margin = [int]($size * 0.08)
    $g.FillEllipse(
        [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 26, 39, 68)),
        $margin, $margin, $size - 2 * $margin, $size - 2 * $margin
    )
    $eye = [int]($size * 0.08)
    $g.FillEllipse(
        [System.Drawing.Brushes]::LightBlue,
        [int]($size * 0.28), [int]($size * 0.35), $eye, $eye
    )
    $g.FillEllipse(
        [System.Drawing.Brushes]::LightBlue,
        [int]($size * 0.58), [int]($size * 0.35), $eye, $eye
    )
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

New-AvatarIcon 32 (Join-Path $iconsDir "32x32.png")
New-AvatarIcon 128 (Join-Path $iconsDir "128x128.png")
Copy-Item (Join-Path $iconsDir "128x128.png") (Join-Path $iconsDir "128x128@2x.png")
Copy-Item (Join-Path $iconsDir "128x128.png") (Join-Path $iconsDir "icon.icns")

# Windows resource compiler requires a real ICO (not a renamed PNG).
$iconBmp = New-Object System.Drawing.Bitmap 256, 256
$iconG = [System.Drawing.Graphics]::FromImage($iconBmp)
$iconG.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$iconG.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$iconMargin = 20
$iconG.FillEllipse(
    [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 26, 39, 68)),
    $iconMargin, $iconMargin, 256 - 2 * $iconMargin, 256 - 2 * $iconMargin
)
$iconEye = 20
$iconG.FillEllipse([System.Drawing.Brushes]::LightBlue, 72, 90, $iconEye, $iconEye)
$iconG.FillEllipse([System.Drawing.Brushes]::LightBlue, 148, 90, $iconEye, $iconEye)
$iconG.Dispose()
$hIcon = $iconBmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$icoPath = Join-Path $iconsDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$iconBmp.Dispose()

Write-Host "Icons created in $iconsDir"
