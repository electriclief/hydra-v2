# WakeWord - the recogniser child.
#
# Kept in PowerShell because Windows' own speech engine is a .NET assembly: no model file, no download, instant, and it
# is already on every Windows box in this fleet. It listens ONLY for the phrase it was given, which is what makes it
# cheap - the grammar is one phrase, not a language.
#
# Output contract with the door (one line per event, tab separated):
#   HIT<TAB><what it heard><TAB><confidence 0..1>
#   FAIL<TAB><reason>
#
# It exits if the microphone cannot be opened; the door reports that as `failed` rather than pretending to listen.
param(
  [string]$Phrase = 'are you listening'
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
} catch {
  Write-Output ("FAIL`tno_speech_engine: " + $_.Exception.Message)
  exit 2
}

try {
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $rec.SetInputToDefaultAudioDevice()
} catch {
  Write-Output ("FAIL`tno_mic: " + $_.Exception.Message)
  exit 3
}

# variants a person actually says, all mapped to the one phrase
$alts = New-Object System.Speech.Recognition.Choices
foreach ($v in @($Phrase.Split('|'))) {
  $alts.Add($v.Trim())
  $alts.Add($v.Trim() + '?')
  $alts.Add('hey ' + $v.Trim())
  $alts.Add('ok ' + $v.Trim())
}
$gb = New-Object System.Speech.Recognition.GrammarBuilder
$gb.Append($alts)
$grammar = New-Object System.Speech.Recognition.Grammar($gb)
$grammar.Name = 'wake'
$rec.LoadGrammar($grammar)
$rec.InitialSilenceTimeout = [TimeSpan]::FromSeconds(10)
$rec.BabbleTimeout = [TimeSpan]::FromSeconds(4)
$rec.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(300)

# a fixed phrase recogniser rejects far more than it accepts; only a real acceptance is a hit
$handler = {
  param($sender, $e)
  $t = $e.Result.Text
  $c = [double]$e.Result.Confidence
  [Console]::Out.WriteLine("HIT`t" + $t + "`t" + $c.ToString('0.###'))
  [Console]::Out.Flush()
}
Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -Action $handler | Out-Null

Write-Output ("READY`t" + $Phrase)
[Console]::Out.Flush()

# stay alive; the door kills this process to disarm
while ($true) {
  try { $rec.Recognize([TimeSpan]::FromSeconds(5)) | Out-Null } catch { Write-Output ("FAIL`trecognize: " + $_.Exception.Message); exit 4 }
  Start-Sleep -Milliseconds 50
}
