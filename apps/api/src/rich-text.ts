import sanitizeHtml from 'sanitize-html';

export const MAX_CHANGE_CONTENT_LENGTH = 20000;

const options: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
  transformTags: {
    b: 'strong',
    i: 'em',
    div: 'p'
  }
};

export function sanitizeChangeContent(value: string) {
  const sanitized = sanitizeHtml(value.slice(0, MAX_CHANGE_CONTENT_LENGTH), options).trim();
  const plainText = sanitizeHtml(sanitized, { allowedTags: [], allowedAttributes: {} }).trim();
  return plainText ? sanitized : '';
}
