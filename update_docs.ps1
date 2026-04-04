$basePath = "d:\Codes\Hackathon"

# Layer_2
$f = Join-Path $basePath "Layer_2_API_Gateway.md"
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$c = $c.Replace("Prior Authorization Required.", "Terms and Conditions Apply.")
$c = $c.Replace("All members must verify their network status.", "All users must verify their account details.")
$c = $c.Replace("policy_2024.docx", "report_2024.docx")
$c = $c.Replace("glossary-healthcare-v1", "glossary-general-v1")
$c = $c.Replace("Professional, Corporate Healthcare", "Professional, General Purpose")
$c = $c.Replace("Check your network status.", "Please verify your account details.")
$c = $c.Replace("'copay' vs 'co-pay'", "'ecommerce' vs 'e-commerce'")
$c = $c.Replace("""copay"" vs ""co-pay"" in different segments", """ecommerce"" vs ""e-commerce"" in different segments")
$c = $c.Replace("""copay""", """ecommerce""")
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
Write-Host "Layer_2 done"

# Layer_3
$f = Join-Path $basePath "Layer_3_Core_RAG_Engine.md"
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$c = $c.Replace("[Healthcare Insurance] Check your network.", "[General Business] Please verify your account details.")
$c = $c.Replace("healthcare vs. IT networking", "business vs. IT networking")
$c = $c.Replace("Corporate Healthcare", "General Purpose")
$c = $c.Replace("""healthcare"", ""legal"", ""finance""", """general"", ""legal"", ""finance""")
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
Write-Host "Layer_3 done"

# Layer_4
$f = Join-Path $basePath "Layer_4_LLM_Orchestration.md"
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$c = $c.Replace("[Healthcare Insurance] Check your network.", "[General Business] Please verify your account details.")
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
Write-Host "Layer_4 done"

# Layer_5
$f = Join-Path $basePath "Layer_5_Training_Pipeline.md"
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$c = $c.Replace("Check your network status before proceeding.", "Please verify your account details before proceeding.")
$c = $c.Replace("the following healthcare text", "the following text")
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
Write-Host "Layer_5 done"

Write-Host "All replacements complete!"
