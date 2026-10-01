# standards/*.docx → 같은 이름 .hwpx (한글 COM). 표준 산출방법서 견본의 한글판을 만든다.
#   powershell -ExecutionPolicy Bypass -File scripts/make-standard-hwpx.ps1 [-Files "standards/표준_산출방법서_종신보험.docx" ...]
# 한글은 Word 수식을 10pt 로 가져오므로 저장 전에 수식 개체(eqed)마다 BaseUnit 을 1200(12pt) 으로 맞춘다.
# 주의: 이 COM 을 한 번 강제 종료(Stop-Process Hwp)하면 다음 Open 이 보이지 않는 대화상자에 막혀 멈춘다 — 한 번에 끝낸다.
param([string[]]$Files)
$ErrorActionPreference = "Stop"
if (-not $Files -or $Files.Count -eq 0) { $Files = Get-ChildItem standards/*.docx | ForEach-Object { $_.FullName } }
$hwp = New-Object -ComObject HWPFrame.HwpObject
$hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") | Out-Null   # 보안 승인 창 없이 파일을 열게
try {
  foreach ($f in $Files) {
    $src = (Resolve-Path -LiteralPath $f).Path
    $dst = [System.IO.Path]::ChangeExtension($src, ".hwpx")
    if (-not $hwp.Open($src, "MSWORD", "")) { throw "open failed: $src" }
    # 수식 개체마다 글자 크기 12pt
    $ctrl = $hwp.HeadCtrl
    $n = 0
    while ($ctrl -ne $null) {
      if ($ctrl.CtrlID -eq "eqed") {
        $set = $ctrl.Properties
        $set.SetItem("BaseUnit", 1200)
        $ctrl.Properties = $set
        $n++
      }
      $ctrl = $ctrl.Next
    }
    if (-not $hwp.SaveAs($dst, "HWPX", "")) { throw "save failed: $dst" }
    Write-Output "hwpx: $([System.IO.Path]::GetFileName($dst)) $((Get-Item -LiteralPath $dst).Length)B · 수식 $n"
  }
} finally {
  $hwp.Quit()
}
Write-Output "done"
