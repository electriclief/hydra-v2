<#
  Windows built in speech: the voice that is always there.

  Used when a GPU node is not free and no CPU service can be spun up yet. It writes a WAV rather than speaking, so the
  door can return bytes like any other provider - the caller never learns which engine answered.
#>
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) {
    $have = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
    if ($have -contains $Voice) { $s.SelectVoice($Voice) }
  }
  $s.Rate = 0
  $s.SetOutputToWaveFile($Out)
  $s.Speak($Text)
} finally {
  $s.Dispose()
}
if (-not (Test-Path $Out)) { throw "no wav was written" }
