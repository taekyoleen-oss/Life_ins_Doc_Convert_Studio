# 앱이 내는 "엑셀로 내려받기 (수식 포함)" 파일을 엑셀로 다시 계산해 앱 값과 같은지 확인한다.
#   XLSX_UPDATE=1 node node_modules/vitest/vitest.mjs run tests/calc-xlsx.test.ts   → samples/09_종신보험(암진단포함)_보험료계산.xlsx
#   powershell -ExecutionPolicy Bypass -File scripts/check-calc-xlsx.ps1
# 확인: 담보별 10만원당(261 · 163) · 담보 보험료 · 합계(424 · 342,500) · 연도별 10만원당 책임준비금 = samples/09_…_계산결과.json (자유설계보험 엔진)
param([string]$Path = "samples/09_종신보험(암진단포함)_보험료계산.xlsx", [string]$Want = "samples/09_종신보험(암진단포함)_계산결과.json")
$ErrorActionPreference = "Stop"
$full = (Resolve-Path -LiteralPath $Path).Path
$expect = Get-Content -LiteralPath $Want -Raw -Encoding UTF8 | ConvertFrom-Json   # ($want 로 받으면 [string] 매개변수 $Want 와 같은 변수라 글자로 바뀐다)
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($full)
  $xl.CalculateFull()
  $ws = $wb.Worksheets.Item(1)
  $ok = $true
  # 결과 칸: 2행에서 담보 이름 열을 찾고, 결과 이름 열에서 줄을 찾는다
  $used = $ws.UsedRange
  $cols = $used.Columns.Count; $rows = $used.Rows.Count
  $labelCol = 0
  for ($c = 1; $c -le $cols; $c++) { if ($ws.Cells.Item(3, $c).Text -eq "보장기간 n (년)") { $labelCol = $c; break } }
  if ($labelCol -eq 0) { throw "결과 칸(보장기간 n)을 찾지 못했습니다" }
  $rowOf = @{}
  for ($r = 3; $r -le 3 + 30; $r++) { $t = $ws.Cells.Item($r, $labelCol).Text; if ($t) { $rowOf[$t] = $r } }
  $r100 = ($rowOf.Keys | Where-Object { $_ -like "10만원당 보험료*" } | Select-Object -First 1)
  $rPrem = ($rowOf.Keys | Where-Object { $_ -like "담보 보험료 (원)*" } | Select-Object -First 1)   # "담보 보험료의 합이 …" 안내 줄과 겹치지 않게
  $n = $expect.coverages.Count
  for ($i = 0; $i -lt $n; $i++) {
    $c = $labelCol + 1 + $i
    $name = $ws.Cells.Item(2, $c).Text
    $g = [double]$ws.Cells.Item($rowOf[$r100], $c).Value2
    $prem = [double]$ws.Cells.Item($rowOf[$rPrem], $c).Value2
    $w = $expect.coverages[$i]
    $d1 = $g - $w.gross100k; $d2 = $prem - $w.monthlyGross
    if ([math]::Abs($d1) -gt 0 -or [math]::Abs($d2) -gt 0) { $ok = $false }
    Write-Output ("{0}: 10만원당 엑셀 {1} / 앱 {2} · 담보 보험료 엑셀 {3} / 앱 {4}" -f $name, $g, $w.gross100k, $prem, $w.monthlyGross)
    # 연도별 10만원당 준비금 — 이 담보 구역의 "V^{10만} …" 열
    $vcol = 0
    $k = 0
    for ($cc = 1; $cc -le $cols; $cc++) { if ($ws.Cells.Item(2, $cc).Text -like "V^{10만}*") { if ($k -eq $i) { $vcol = $cc; break }; $k++ } }
    $maxd = 0
    for ($t = 0; $t -le $w.n; $t++) {
      $v = [double]$ws.Cells.Item(3 + $t, $vcol).Value2
      $d = [math]::Abs($v - $w.reserve100k[$t]); if ($d -gt $maxd) { $maxd = $d }
    }
    if ($maxd -gt 0) { $ok = $false }
    Write-Output ("{0}: 연도별 10만원당 준비금 차이 최대 {1} (t = 0 … {2})" -f $name, $maxd, $w.n)
  }
  $sumCol = $labelCol + 1 + $n
  $tot100 = [double]$ws.Cells.Item($rowOf[$r100], $sumCol).Value2; $totPrem = [double]$ws.Cells.Item($rowOf[$rPrem], $sumCol).Value2
  $wantTot100 = ($expect.coverages | Measure-Object -Property gross100k -Sum).Sum
  if ($tot100 -ne $wantTot100 -or $totPrem -ne $expect.monthlyGross) { $ok = $false }
  Write-Output ("합계: 10만원당 엑셀 {0} / 앱 {1} · 보험료 엑셀 {2} / 앱 {3}" -f $tot100, $wantTot100, $totPrem, $expect.monthlyGross)
  Write-Output ($(if ($ok) { "RESULT OK — 엑셀 수식 결과 = 앱 계산 = 자유설계보험 엔진" } else { "RESULT DIFF — 차이가 있습니다" }))
} finally {
  if ($wb) { $wb.Close($false) }
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
