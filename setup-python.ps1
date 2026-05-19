# setup-python.ps1
# Sets up Python embeddable + faster-whisper + yt-dlp in src-tauri/binaries/python/
# Run from project root: powershell -ExecutionPolicy Bypass -File .\setup-python.ps1
#
# IDEMPOTENT: safe to re-run, will skip already-done steps.

$ErrorActionPreference = "Stop"

# Resolve project paths
$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = (Get-Location).Path }
$pythonDir = Join-Path $projectRoot "src-tauri\binaries\python"
$scriptsDir = Join-Path $pythonDir "scripts"

Write-Host "=== LoadLink Python setup ===" -ForegroundColor Cyan
Write-Host "Target: $pythonDir" -ForegroundColor Cyan

# Step 1: Download Python 3.11 embeddable (only if not already present)
$pythonExe = Join-Path $pythonDir "python.exe"
if (Test-Path $pythonExe) {
  Write-Host "[1/6] Python already present, skipping download" -ForegroundColor Yellow
} else {
  Write-Host "[1/6] Downloading Python 3.11.9 embeddable..." -ForegroundColor Cyan
  $url = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
  New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
  $zipPath = Join-Path $pythonDir "python-embed.zip"
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $pythonDir -Force
  Remove-Item $zipPath
  Write-Host "      Python extracted." -ForegroundColor Green
}

# Step 2: Enable site-packages (uncomment "import site" in python311._pth)
$pthFile = Join-Path $pythonDir "python311._pth"
if (Test-Path $pthFile) {
  $pthContent = Get-Content $pthFile -Raw
  if ($pthContent -match '#import site') {
    Write-Host "[2/6] Enabling site-packages..." -ForegroundColor Cyan
    $pthContent = $pthContent -replace '#import site', 'import site'
    Set-Content -Path $pthFile -Value $pthContent -NoNewline
    Write-Host "      site-packages enabled." -ForegroundColor Green
  } else {
    Write-Host "[2/6] site-packages already enabled, skipping" -ForegroundColor Yellow
  }
} else {
  Write-Host "[2/6] WARN: python311._pth not found" -ForegroundColor Yellow
}

# Step 3: Install pip
$pipScript = Join-Path $pythonDir "Scripts\pip.exe"
if (Test-Path $pipScript) {
  Write-Host "[3/6] pip already installed, skipping" -ForegroundColor Yellow
} else {
  Write-Host "[3/6] Installing pip..." -ForegroundColor Cyan
  $getpipPath = Join-Path $pythonDir "get-pip.py"
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getpipPath -UseBasicParsing
  & $pythonExe $getpipPath
  Remove-Item $getpipPath
  Write-Host "      pip installed." -ForegroundColor Green
}

# Step 4: Install faster-whisper (and its dependencies)
Write-Host "[4/6] Checking faster-whisper..." -ForegroundColor Cyan
$fwCheck = & $pythonExe -c "import faster_whisper; print(faster_whisper.__version__)" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "      faster-whisper already installed (version $fwCheck), skipping" -ForegroundColor Yellow
} else {
  Write-Host "      Installing faster-whisper (this will take 2-5 min, ~200 Mo)..." -ForegroundColor Cyan
  & $pythonExe -m pip install faster-whisper
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: faster-whisper install failed" -ForegroundColor Red
    exit 1
  }
  Write-Host "      faster-whisper installed." -ForegroundColor Green
}

# Step 5: Install yt-dlp Python package (separate from yt-dlp.exe, used by whisper_runner.py)
Write-Host "[5/6] Checking yt-dlp Python package..." -ForegroundColor Cyan
$ytCheck = & $pythonExe -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "      yt-dlp already installed (version $ytCheck), skipping" -ForegroundColor Yellow
} else {
  Write-Host "      Installing yt-dlp..." -ForegroundColor Cyan
  & $pythonExe -m pip install yt-dlp
  Write-Host "      yt-dlp installed." -ForegroundColor Green
}

# Step 6: Create scripts dir (whisper_runner.py will go here in later step)
Write-Host "[6/6] Setting up scripts directory..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
Write-Host "      scripts dir ready: $scriptsDir" -ForegroundColor Green

# Final validation
Write-Host ""
Write-Host "=== Validation ===" -ForegroundColor Cyan
$fwVer = & $pythonExe -c "from faster_whisper import WhisperModel; import faster_whisper; print(faster_whisper.__version__)" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "OK : faster-whisper $fwVer fonctionne" -ForegroundColor Green
} else {
  Write-Host "FAIL : faster-whisper validation failed" -ForegroundColor Red
  Write-Host $fwVer -ForegroundColor Red
  exit 1
}

$ytVer = & $pythonExe -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "OK : yt-dlp $ytVer fonctionne" -ForegroundColor Green
} else {
  Write-Host "FAIL : yt-dlp validation failed" -ForegroundColor Red
  exit 1
}

# Size report
$totalSize = (Get-ChildItem -Path $pythonDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalMB = [math]::Round($totalSize / 1MB, 1)
Write-Host ""
Write-Host "Total size: $totalMB Mo" -ForegroundColor Cyan
Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Next: write whisper_runner.py into $scriptsDir" -ForegroundColor Cyan
