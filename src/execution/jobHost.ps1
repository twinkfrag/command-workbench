param([Parameter(Mandatory=$true)][string]$Endpoint)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# ProcessStartInfo.Arguments follows Windows argv quoting, not PowerShell syntax.
# Always quote, including empty strings, quotes and trailing backslashes.
function ConvertTo-ProcessArgument([string]$Value) {
    $quoted = New-Object System.Text.StringBuilder
    [void]$quoted.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]92) { $slashes++; continue }
        if ($character -eq [char]34) {
            [void]$quoted.Append([char]92, (2 * $slashes + 1))
        } else { [void]$quoted.Append([char]92, $slashes) }
        [void]$quoted.Append($character)
        $slashes = 0
    }
    [void]$quoted.Append([char]92, (2 * $slashes))
    [void]$quoted.Append('"')
    return $quoted.ToString()
}

function Send-Message($Message) {
    $writer.WriteLine((ConvertTo-Json -InputObject $Message -Compress -Depth 10))
}

function Wait-ForEnter {
    Write-Host 'Enter キーでターミナルを閉じます。'
    if ([Console]::IsInputRedirected) { [void][Console]::ReadLine(); return }
    while ([Console]::ReadKey($true).Key -ne [ConsoleKey]::Enter) {}
}

$pipe = $null
$reader = $null
$writer = $null
$child = $null
try {
    Write-Host 'Command Workbench: ジョブを開始します。'
    $pipeName = $Endpoint.Substring('\\.\pipe\'.Length)
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(10000)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $reader = New-Object System.IO.StreamReader($pipe, $encoding)
    $writer = New-Object System.IO.StreamWriter($pipe, $encoding)
    $writer.AutoFlush = $true
    $job = ConvertFrom-Json -InputObject $reader.ReadLine()
    $result = @{ status = 'completed' }
    for ($index = 0; $index -lt $job.steps.Count; $index++) {
        $step = $job.steps[$index]
        $arguments = @($step.argv | ForEach-Object { ConvertTo-ProcessArgument ([string]$_) })
        Write-Host ("`nStep {0}/{1}: {2} {3}" -f ($index + 1), $job.steps.Count, (ConvertTo-ProcessArgument $step.executablePath), ($arguments -join ' '))
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $step.executablePath
        $startInfo.Arguments = $arguments -join ' '
        $startInfo.WorkingDirectory = $step.cwd
        $startInfo.UseShellExecute = $false
        if ($step.env) {
            foreach ($property in $step.env.PSObject.Properties) {
                $startInfo.EnvironmentVariables[$property.Name] = [string]$property.Value
            }
        }
        Send-Message @{ type = 'step'; index = $index }
        $exitCode = $null
        try {
            $child = [System.Diagnostics.Process]::Start($startInfo)
            $child.WaitForExit()
            $exitCode = $child.ExitCode
        } catch { Write-Host ('起動できません: ' + $_.Exception.Message) }
        finally { if ($child) { $child.Dispose(); $child = $null } }
        if ($exitCode -ne 0) {
            $result = @{ status = 'failed'; failedStep = $index; exitCode = $exitCode }
            break
        }
    }
    if ($result.status -eq 'completed') { Write-Host "`nJob が正常終了しました。" }
    else {
        $displayCode = if ($null -eq $result.exitCode) { '不明' } else { $result.exitCode }
        Write-Host ("`nStep {0} が失敗しました（終了コード: {1}）。" -f ($result.failedStep + 1), $displayCode)
    }
    Send-Message @{ type = 'complete'; result = $result }
    $writer.Dispose(); $writer = $null
    $reader.Dispose(); $reader = $null
    $pipe.Dispose(); $pipe = $null
    Wait-ForEnter
    # The child result was already reported. A successful display-host exit
    # lets Task presentation.close remove the terminal without a second prompt.
    exit 0
} catch { Write-Host ('ジョブを実行できません: ' + $_.Exception.Message); exit 1 }
finally {
    if ($child) { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose() }
    if ($writer) { $writer.Dispose() }
    if ($reader) { $reader.Dispose() }
    if ($pipe) { $pipe.Dispose() }
}
