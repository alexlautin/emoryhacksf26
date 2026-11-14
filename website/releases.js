// The only place download links live. The buttons read this file and nothing else.
// Windows stays "coming soon" until comingSoon is false, published is true,
// and url is a real https link to a file that exists.
export const RELEASES = {
  macos: {
    // Swap this for the published .dmg, then set published to true.
    // While published is false the button still points here, and the page says
    // the file is not actually up.
    url: 'https://github.com/alexlautin/emoryhacksf26/releases/download/v0.1.0/Lookout.dmg',
    published: false,
    comingSoon: false,
  },
  windows: {
    url: null,
    published: false,
    comingSoon: true,
  },
};
