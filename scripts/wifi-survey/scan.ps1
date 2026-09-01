<#
.SYNOPSIS
  教室棟で見えている無線APを1地点ぶん記録する。

.DESCRIPTION
  netsh の生出力を**そのまま**1行のJSONへ同梱してから、解析結果を足す。
  現地は撮り直しが効かないので、私の書いたパーサが Windows の言語や版で
  外れても、生テキストさえ残っていれば後から解析し直せる。パーサの正しさに
  当日のデータを賭けない、というのがこのスクリプトの唯一の設計方針。

.PARAMETER Label
  どこで測ったか。「3F 301教室 教壇」のように、後で図面上に置ける粒度で書く。

.PARAMETER Repeat
  同じ地点で何回スキャンするか。APの見え方は数秒で入れ替わるので既定は3回。

.EXAMPLE
  .\scan.ps1 -Label "3F 301教室 中央"
  .\scan.ps1 -Label "3F 廊下 301前" -Repeat 5
#>
param(
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$Out,
  [int]$Repeat = 3,
  [int]$IntervalSeconds = 3,
  [string]$Note = ""
)

$ErrorActionPreference = "Stop"

if (-not $Out) {
  $Out = Join-Path (Get-Location) ("tmp\wifi-survey\scan-" + (Get-Date -Format "yyyyMMdd") + ".jsonl")
}
$directory = Split-Path -Parent $Out
if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }

$service = Get-Service -Name wlansvc -ErrorAction SilentlyContinue
if ($null -eq $service -or $service.Status -ne "Running") {
  throw "WLAN AutoConfig (wlansvc) が動いていません。WiFiアダプタを有効にしてから実行してください。"
}

<#
  netsh はロケールで見出しが訳される（Signal→信号、Channel→チャネル）。
  訳されないのは "SSID n :" と "BSSID n :" と MAC の書式だけなので、
  そこだけを錨にして、残りは値の形（%付き、裸の整数）で拾う。
#>
function Parse-NetshOutput {
  param([string[]]$Lines)

  $networks = @()
  $ssid = $null
  $current = $null

  foreach ($line in $Lines) {
    if ($line -match '^\s*SSID\s+\d+\s*:\s*(.*?)\s*$') {
      $ssid = $Matches[1]
      continue
    }
    if ($line -match '^\s*BSSID\s+\d+\s*:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s*$') {
      $current = [ordered]@{
        ssid    = $ssid
        bssid   = $Matches[1].ToLower()
        quality = $null
        dbm     = $null
        channel = $null
      }
      $networks += , $current
      continue
    }
    if ($null -eq $current) { continue }

    if ($null -eq $current.quality -and $line -match ':\s*(\d{1,3})\s*%\s*$') {
      $quality = [int]$Matches[1]
      $current.quality = $quality
      # WLAN_SIGNAL_QUALITY は 0..100 の線形尺度で、0%=-100dBm、100%=-50dBm。
      # Google Geolocation API は dBm を要求するので、ここで戻す。
      $current.dbm = [math]::Round($quality / 2.0 - 100.0, 1)
      continue
    }
    if ($null -eq $current.channel -and $line -match ':\s*(\d{1,3})\s*$') {
      $current.channel = [int]$Matches[1]
      continue
    }
  }
  return $networks
}

$written = 0
for ($index = 1; $index -le $Repeat; $index++) {
  $raw = & netsh wlan show networks mode=bssid 2>&1
  $rawText = ($raw | Out-String)
  $networks = Parse-NetshOutput -Lines ($rawText -split "`r?`n")

  $record = [ordered]@{
    schemaVersion = 1
    label         = $Label
    note          = $Note
    at            = (Get-Date).ToString("o")
    scan          = $index
    of            = $Repeat
    hostname      = $env:COMPUTERNAME
    networks      = $networks
    raw           = $rawText
  }

  $json = $record | ConvertTo-Json -Depth 6 -Compress
  # BOM なしで追記する。BOM が混ざると1行目の JSON.parse が落ちる。
  [System.IO.File]::AppendAllText($Out, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  $written++

  $distinct = ($networks | Select-Object -ExpandProperty bssid -Unique).Count
  Write-Host ("[{0}/{1}] {2} — AP {3}件 / BSSID {4}件" -f $index, $Repeat, $Label, $networks.Count, $distinct)

  if ($index -lt $Repeat) { Start-Sleep -Seconds $IntervalSeconds }
}

Write-Host ""
Write-Host ("→ {0} へ {1} スキャン追記しました。" -f $Out, $written)
if (($networks | Measure-Object).Count -eq 0) {
  Write-Warning "APが1件も取れていません。Windowsの位置情報設定がオフだと netsh が空を返すことがあります。設定 > プライバシーとセキュリティ > 位置情報 を確認してください。"
}
