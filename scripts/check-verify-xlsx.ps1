# 엑셀 검산 파일을 엑셀로 다시 계산해 수식 결과와 앱(자유설계보험) 값의 차이를 확인하고, 계산된 값까지 저장한다.
#   powershell -ExecutionPolicy Bypass -File scripts/check-verify-xlsx.ps1 [-Path samples/09_종신보험(암진단포함)_검산.xlsx]
param([string]$Path = "samples/09_종신보험(암진단포함)_검산.xlsx")
$ErrorActionPreference = "Stop"
$full = (Resolve-Path -LiteralPath $Path).Path
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($full)
  $xl.CalculateFull()
  $ws = $wb.Worksheets.Item("보험료")
  $ok = $true
  foreach ($r in 2..4) {
    $name = $ws.Cells.Item($r, 1).Text
    $g = $ws.Cells.Item($r, 9).Value2; $ga = $ws.Cells.Item($r, 10).Value2
    $mo = $ws.Cells.Item($r, 12).Value2; $moa = $ws.Cells.Item($r, 13).Value2
    $vd = $ws.Cells.Item($r, 15).Value2
    $d1 = [double]$ws.Cells.Item($r, 11).Value2; $d2 = [double]$ws.Cells.Item($r, 14).Value2
    if ([math]::Abs($d1) -gt 0 -or [math]::Abs($d2) -gt 0 -or [math]::Abs([double]$vd) -gt 0) { $ok = $false }
    Write-Output ("{0}: 10만원당 G 엑셀 {1} / 앱 {2} · 월보험료 엑셀 {3} / 앱 {4} · 준비금 차이 최대 {5}" -f $name, $g, $ga, $mo, $moa, $vd)
  }
  foreach ($sh in @("기수_사망장해", "기수_암진단")) {
    $w = $wb.Worksheets.Item($sh)
    $rel = 0
    foreach ($r in 2..13) {
      $e = $w.Cells.Item($r, 5).Value2; $a = $w.Cells.Item($r, 6).Value2
      if ($a -ne $null -and [double]$a -ne 0) { $rel = [math]::Max($rel, [math]::Abs(([double]$e - [double]$a) / [double]$a)) }
    }
    Write-Output ("{0}: PVB·N*·P·P_base·G·P_β 상대 차이 최대 {1:E2}" -f $sh, $rel)
    if ($rel -gt 1e-9) { $ok = $false }
  }
  $wb.Save()
  Write-Output ($(if ($ok) { "RESULT OK — 수식 결과 = 앱 계산" } else { "RESULT DIFF — 차이가 있습니다" }))
} finally {
  if ($wb) { $wb.Close($true) }
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
