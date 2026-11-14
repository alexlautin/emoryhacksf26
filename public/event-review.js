export const REVIEW_VERDICTS = {
  expected: 'Likely expected',
  investigate: 'Worth investigating',
  insufficient: 'Insufficient evidence',
};

export function canReviewEvent(event) {
  return event?.risk === 'medium' && !!event.agentId && !event.baseline &&
    ['process', 'tool', 'network', 'file'].includes(event.kind);
}
