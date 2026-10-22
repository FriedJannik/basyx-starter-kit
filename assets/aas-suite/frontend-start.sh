#!/bin/sh
set -eu
ROOT_DIR="/usr/share/caddy"
if [ -d "/usr/share/caddy/browser" ]; then
  ROOT_DIR="/usr/share/caddy/browser"
fi
FRONTEND_API_BASE_URL="${FRONTEND_API_BASE_URL%/}"
FRONTEND_FEEDMAPPING_BASE_URL="${FRONTEND_FEEDMAPPING_BASE_URL%/}"
GATEWAY_BASE_URL="${FRONTEND_API_BASE_URL%/designer-api}"
# Encode environment values as JSON string literals, including controls and trailing newlines.
json_string() {
  printf '%s.' "$1" | LC_ALL=C awk '
    BEGIN { for (i = 0; i < 32; i++) control[sprintf("%c", i)] = sprintf("\\u%04x", i) }
    { if (NR > 1) value = value "\n"; value = value $0 }
    END {
      value = substr(value, 1, length(value) - 1)
      printf "\""
      for (i = 1; i <= length(value); i++) {
        c = substr(value, i, 1)
        if (c == "\\") printf "\\\\"
        else if (c == "\"") printf "\\\""
        else if (c == "\047") printf "\\u0027"
        else if (c == "<") printf "\\u003c"
        else if (c == "`") printf "\\u0060"
        else if (c == "$") printf "\\u0024"
        else if (c in control) printf "%s", control[c]
        else printf "%s", c
      }
      printf "\""
    }'
}

# The same encoded content is safe in either quote style in existing JS bundles.
sed_replacement() {
  json_string "$1" | sed 's/^"//; s/"$//; s/[\\&|]/\\&/g'
}

RUNTIME_CONFIG_FILE="$ROOT_DIR/runtime-config.js"
printf 'window.__AAS_FRONTEND_API_BASE_URL = %s;\nwindow.__AAS_FRONTEND_FEEDMAPPING_BASE_URL = %s;\n' \
  "$(json_string "$FRONTEND_API_BASE_URL")" "$(json_string "$FRONTEND_FEEDMAPPING_BASE_URL")" >"$RUNTIME_CONFIG_FILE"
ESCAPED_API_BASE_URL="$(sed_replacement "$FRONTEND_API_BASE_URL")"
ESCAPED_API_BASE_URL_WITH_SLASH="$(sed_replacement "$FRONTEND_API_BASE_URL/")"
ESCAPED_DESIGNER_BASE_URL="$ESCAPED_API_BASE_URL"
ESCAPED_GATEWAY_BASE_URL="$(sed_replacement "$GATEWAY_BASE_URL")"
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i "s|http://localhost:5196/designer-api|$ESCAPED_API_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i "s|http://localhost:5196/designer|$ESCAPED_DESIGNER_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i "s|http://localhost:5196|$ESCAPED_GATEWAY_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i "s|strictDiscoveryDocumentValidation:!1,skipIssuerCheck:!0|strictDiscoveryDocumentValidation:!1,skipIssuerCheck:!0,requireHttps:!1|g" {} +
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i "s|strictDiscoveryDocumentValidation:false,skipIssuerCheck:true|strictDiscoveryDocumentValidation:false,skipIssuerCheck:true,requireHttps:false|g" {} +
find "$ROOT_DIR" -type f -name '*.js' ! -name 'runtime-config.js' -exec sed -i 's|requireHttps:\"remoteOnly\"|requireHttps:!1|g' {} +
CONFIG_FILE="$ROOT_DIR/config/app-config.json"
if [ -f "$CONFIG_FILE" ]; then
  sed -i "s|http://localhost:5196/designer/|$ESCAPED_API_BASE_URL_WITH_SLASH|g" "$CONFIG_FILE"
  sed -i "s|http://localhost:5196|$ESCAPED_GATEWAY_BASE_URL|g" "$CONFIG_FILE"
  sed -i "s|\"apiPath\": \"$ESCAPED_API_BASE_URL\"|\"apiPath\": \"$ESCAPED_API_BASE_URL/api\"|g" "$CONFIG_FILE"
  sed -i 's|"apiPath": "/designer-api"|"apiPath": "/designer-api/api"|g' "$CONFIG_FILE"
  sed -i 's|"aasApiPath": "/designer/|"aasApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasProxyApiPath": "/designer/|"aasProxyApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasSharedLinksApiPath": "/designer/|"aasSharedLinksApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasDashboardApiPath": "/designer/|"aasDashboardApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasSystemManagementApiPath": "/designer/|"aasSystemManagementApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasHelpApiPath": "/designer/|"aasHelpApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasViewerApiPath": "/designer/|"aasViewerApiPath": "/designer-api/|g' "$CONFIG_FILE"
  sed -i 's|"aasViewerProxyPath": "/designer/|"aasViewerProxyPath": "/designer-api/|g' "$CONFIG_FILE"
fi
FALLBACK_CONFIG_FILE="/usr/share/caddy/config/app-config.json"
if [ -f "$FALLBACK_CONFIG_FILE" ]; then
  sed -i "s|http://localhost:5196/designer/|$ESCAPED_API_BASE_URL_WITH_SLASH|g" "$FALLBACK_CONFIG_FILE"
  sed -i "s|http://localhost:5196|$ESCAPED_GATEWAY_BASE_URL|g" "$FALLBACK_CONFIG_FILE"
  sed -i "s|\"apiPath\": \"$ESCAPED_API_BASE_URL\"|\"apiPath\": \"$ESCAPED_API_BASE_URL/api\"|g" "$FALLBACK_CONFIG_FILE"
  sed -i 's|"apiPath": "/designer-api"|"apiPath": "/designer-api/api"|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasApiPath": "/designer/|"aasApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasProxyApiPath": "/designer/|"aasProxyApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasSharedLinksApiPath": "/designer/|"aasSharedLinksApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasDashboardApiPath": "/designer/|"aasDashboardApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasSystemManagementApiPath": "/designer/|"aasSystemManagementApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasHelpApiPath": "/designer/|"aasHelpApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasViewerApiPath": "/designer/|"aasViewerApiPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
  sed -i 's|"aasViewerProxyPath": "/designer/|"aasViewerProxyPath": "/designer-api/|g' "$FALLBACK_CONFIG_FILE"
fi
INDEX_FILE="$ROOT_DIR/index.html"
if [ -f "$INDEX_FILE" ] && ! grep -q "runtime-config.js" "$INDEX_FILE"; then
  sed -i 's#<head>#<head><script src="runtime-config.js"></script>#' "$INDEX_FILE"
fi
cat >/tmp/Caddyfile <<EOF
{
  auto_https off
}
:80 {
  root * $ROOT_DIR
  encode gzip
  try_files {path} /index.html
  file_server
}
EOF
exec caddy run --config /tmp/Caddyfile --adapter caddyfile
