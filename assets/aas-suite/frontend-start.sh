#!/bin/sh
set -eu
ROOT_DIR="/usr/share/caddy"
if [ -d "/usr/share/caddy/browser" ]; then
  ROOT_DIR="/usr/share/caddy/browser"
fi
FRONTEND_API_BASE_URL="${FRONTEND_API_BASE_URL%/}"
FRONTEND_FEEDMAPPING_BASE_URL="${FRONTEND_FEEDMAPPING_BASE_URL%/}"
GATEWAY_BASE_URL="${FRONTEND_API_BASE_URL%/designer-api}"
RUNTIME_CONFIG_FILE="$ROOT_DIR/runtime-config.js"
cat >"$RUNTIME_CONFIG_FILE" <<EOF
window.__AAS_FRONTEND_API_BASE_URL = "${FRONTEND_API_BASE_URL}";
window.__AAS_FRONTEND_FEEDMAPPING_BASE_URL = "${FRONTEND_FEEDMAPPING_BASE_URL}";
EOF
ESCAPED_API_BASE_URL="$(printf '%s' "${FRONTEND_API_BASE_URL}" | sed 's/[&|]/\\&/g')"
ESCAPED_API_BASE_URL_WITH_SLASH="$(printf '%s/' "${FRONTEND_API_BASE_URL}" | sed 's/[&|]/\\&/g')"
DESIGNER_BASE_URL="${FRONTEND_API_BASE_URL}"
ESCAPED_DESIGNER_BASE_URL="$(printf '%s' "$DESIGNER_BASE_URL" | sed 's/[&|]/\\&/g')"
ESCAPED_GATEWAY_BASE_URL="$(printf '%s' "$GATEWAY_BASE_URL" | sed 's/[&|]/\\&/g')"
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i "s|http://localhost:5196/designer-api|$ESCAPED_API_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i "s|http://localhost:5196/designer|$ESCAPED_DESIGNER_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i "s|http://localhost:5196|$ESCAPED_GATEWAY_BASE_URL|g" {} +
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i "s|strictDiscoveryDocumentValidation:!1,skipIssuerCheck:!0|strictDiscoveryDocumentValidation:!1,skipIssuerCheck:!0,requireHttps:!1|g" {} +
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i "s|strictDiscoveryDocumentValidation:false,skipIssuerCheck:true|strictDiscoveryDocumentValidation:false,skipIssuerCheck:true,requireHttps:false|g" {} +
find "$ROOT_DIR" -type f -name '*.js' -exec sed -i 's|requireHttps:\"remoteOnly\"|requireHttps:!1|g' {} +
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
