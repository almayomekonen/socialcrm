# PDF renderer for PDF_RENDERER=gotenberg. Runs on any container host outside AWS.
# Pinned by version AND digest, so a deploy cannot silently change the renderer.
# To upgrade: change both together, then run the checks in README.md.
FROM gotenberg/gotenberg:8.39.0@sha256:13672f317b443c793e972b1bd2155ec62a3e7b6891b411e8196442cc053ee5f5

# Authentication is enforced by Gotenberg itself, so it no longer depends on a load
# balancer rule. It reads GOTENBERG_API_BASIC_AUTH_USERNAME and
# GOTENBERG_API_BASIC_AUTH_PASSWORD from the host's secrets, never from this file.
# JavaScript is off: invoice HTML is self-contained and contains customer text.
CMD ["gotenberg", "--api-port=3000", "--api-timeout=60s", "--api-enable-basic-auth=true", "--chromium-disable-javascript=true", "--api-disable-health-check-logging=true"]
