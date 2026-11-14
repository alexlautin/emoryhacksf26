// Published asset names are kept stable by .github/workflows/release.yml.
const base = 'https://github.com/alexlautin/harness/releases/download/v0.1.3';
export const RELEASE_PAGE = base.replace('/download/', '/tag/');
export const CHECKSUMS_URL = `${base}/SHA256SUMS.txt`;
export const RELEASES = {
  macos: {
    url: `${base}/Harness-macos-arm64.dmg`,
    intelUrl: `${base}/Harness-macos-x64.dmg`,
    published: true,
    comingSoon: false,
  },
  windows: {
    url: `${base}/Harness-windows-x64.exe`,
    published: true,
    comingSoon: false,
  },
};
export const DEVPOST_URL = 'https://devpost.com/software/harness-1rhedk';
