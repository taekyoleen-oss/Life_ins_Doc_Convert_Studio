# samples/·standards/ 의 .docx → 같은 이름 .pdf (Word COM).
# "PDF 로 가져와도 Word 와 같은 조건" 시험(tests/pdf-vs-word.test.ts)이 쓰는 파일을 만든다.
#   powershell -ExecutionPolicy Bypass -File scripts/make-sample-pdf.ps1 -Files "samples/10_...docx"
param([string[]]$Files)
$ErrorActionPreference = "Stop"
if (-not $Files -or $Files.Count -eq 0) { $Files = @("samples/10_기본상품_종신보험(암진단포함)_산출방법서.docx") }
$word = New-Object -ComObject Word.Application
$word.Visible = $false      # DisplayAlerts 는 건드리지 않는다 — PowerShell 5.1 에서 널 참조로 죽는다
try {
  foreach ($f in $Files) {
    $src = (Resolve-Path -LiteralPath $f).Path
    $dst = [System.IO.Path]::ChangeExtension($src, ".pdf")
    $doc = $word.Documents.Open($src)
    $doc.ExportAsFixedFormat($dst, 17)                     # 17 = wdExportFormatPDF
    $doc.Close(0)                                          # 0 = wdDoNotSaveChanges
    Write-Output "pdf: $([System.IO.Path]::GetFileName($dst)) $((Get-Item -LiteralPath $dst).Length)B"
  }
} finally {
  $word.Quit()
}
Write-Output "done"
