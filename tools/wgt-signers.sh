#!/bin/sh
# Prints who signed a Tizen package: the certificate issuer of the author
# signature and of the distributor signature.
#
#   tools/wgt-signers.sh release/FAKE-08.wgt
#
# The Tizen tools fall back to the active security profile without a warning,
# so `make release` runs this to show which certificates were actually used.
set -e
wgt=$1
[ -f "$wgt" ] || { echo "usage: $0 <package.wgt>" >&2; exit 1; }
for sig in author-signature.xml signature1.xml; do
    # The first certificate is the signer's own; the rest is its CA chain.
    cert=$(unzip -p "$wgt" "$sig" | tr -d '\r\n' | grep -o '<X509Certificate>[^<]*' | head -1 | sed 's/<X509Certificate>//')
    [ -n "$cert" ] || { echo "$sig: missing" >&2; exit 1; }
    issuer=$(printf '%s' "$cert" | base64 -d | openssl x509 -inform DER -noout -issuer | sed 's/^issuer=//')
    case $sig in author*) name=author;; *) name=distributor;; esac
    echo "$name signed by: $issuer"
done
