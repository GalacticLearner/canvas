# Package tracked app source separately from dependencies, private runtime state and binaries.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force dist | Out-Null
git archive --format=zip --output=dist/Canvas-source.zip HEAD
