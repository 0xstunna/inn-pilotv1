$path = "c:\inn-pilotv1\scripts\audit\lint-out.txt"
$lines = Get-Content $path
$current = ""
foreach ($line in $lines) {
    if ($line -match "^C:\\\\inn-pilotv1\\\\src") {
        $current = $line
        "=== $current ==="
    } elseif ($line -match "error" -and $current -ne "") {
        "  $line"
    }
}