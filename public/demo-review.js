// Fictional observations shared by the dashboard and the Gemini review route.
// All destination names are reserved examples. These scenarios never run commands.
export const REVIEW_CASES = {
  staging: {
    label: 'Staging health check',
    host: 'staging.example.com',
    events: [
      { id: 1, text: 'The user asked the agent to check the health of staging.example.com.' },
      { id: 2, text: 'A health-check process started directly by the agent used the GET method.' },
      { id: 3, text: 'The health-check process connected to staging.example.com, a server Harness does not recognize.' },
    ],
  },
  install: {
    label: 'Package setup',
    host: 'diagnostics.example.net',
    events: [
      { id: 1, text: 'The user asked the agent to install dependencies and run the unit tests.' },
      { id: 2, text: 'The package manager started a dependency’s setup script.' },
      { id: 3, text: 'The setup script connected to diagnostics.example.net, a server Harness does not recognize. Harness did not capture the connection payload.' },
    ],
  },
};

export const REVIEW_VERDICTS = {
  expected: 'Likely expected',
  investigate: 'Worth investigating',
  insufficient: 'Insufficient evidence',
};
