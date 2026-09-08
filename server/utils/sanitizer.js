const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Basic sanitization using DOMPurify
  const sanitized = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [], // No attributes allowed
    KEEP_CONTENT: true // Keep text content
  });
  
  return sanitized.trim();
}

function sanitizeInput(data) {
  if (typeof data === 'string') {
    return sanitizeString(data);
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        sanitized[key] = sanitizeInput(data[key]);
      }
    }
    return sanitized;
  }
  
  return data;
}

module.exports = {
  sanitizeString,
  sanitizeInput
};