[CmdletBinding()]
param(
    [Parameter(Position=0)][AllowEmptyString()][string]$Message,
    [Parameter(Position=1)][AllowEmptyString()][string]$Literal
)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
'RECEIVED:' + (ConvertTo-Json -InputObject @{
    message = $Message
    literal = $Literal
    cwd = (Get-Location).Path
} -Compress)
