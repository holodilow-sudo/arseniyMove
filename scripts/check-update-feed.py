"""Read-only test of the public updater feed and downloaded release bytes; no credentials."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
REPO = 'holodilow-sudo/arseniyMove'
API = f'https://api.github.com/repos/{REPO}/releases/latest'
MAX_SIZE = 180 * 1024 * 1024


class GithubRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        allowed = {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'}
        if url.scheme != 'https' or url.hostname not in allowed or url.username or url.port not in (None, 443):
            raise ValueError('Untrusted release redirect')
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def get(opener, url):
    return opener.open(urllib.request.Request(url, headers={'User-Agent': 'ArseniyMove-Updater', 'Accept-Encoding': 'identity'}), timeout=30)


def main():
    opener = urllib.request.build_opener(GithubRedirects())
    with get(opener, API) as response:
        raw = response.read(1024 * 1024 + 1)
        assert len(raw) <= 1024 * 1024
        release = json.loads(raw)
    assert release['draft'] is False and release['prerelease'] is False
    version = release['tag_name'].removeprefix('v')
    filename = f'ArseniyMove-{version}.apk'
    matches = [a for a in release['assets'] if a['name'] == filename]
    assert len(matches) == 1
    asset = matches[0]
    assert asset['state'] == 'uploaded' and 0 < asset['size'] <= MAX_SIZE
    assert asset['browser_download_url'] == f'https://github.com/{REPO}/releases/download/{release["tag_name"]}/{filename}'
    local = ROOT / 'dist' / filename
    local_hash = hashlib.sha256(local.read_bytes()).hexdigest()
    assert local.stat().st_size == asset['size']
    assert asset.get('digest') == 'sha256:' + local_hash
    checksum = next(a for a in release['assets'] if a['name'] == filename + '.sha256')
    with get(opener, checksum['browser_download_url']) as response:
        assert response.read(1024).decode().split() == [local_hash, filename]
    count = 0
    digest = hashlib.sha256()
    with get(opener, asset['browser_download_url']) as response:
        while chunk := response.read(256 * 1024):
            count += len(chunk)
            assert count <= asset['size']
            digest.update(chunk)
    assert count == asset['size'] and digest.hexdigest() == local_hash
    report = {'passed': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'publicReleaseApi': API,
              'release': release['html_url'], 'version': version, 'apk': filename, 'bytes': count,
              'sha256': local_hash, 'anonymousDownload': True, 'fullRemoteApkMatchesVerifiedLocalRelease': True,
              'githubDigestAndChecksumSidecarMatch': True, 'phoneInstallationTested': False}
    (ROOT / 'dist' / f'ArseniyMove-{version}-github-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
