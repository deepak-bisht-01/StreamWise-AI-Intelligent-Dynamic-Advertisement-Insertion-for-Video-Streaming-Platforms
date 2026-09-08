const fs = require('fs');
const { readFileSync } = require('fs');

// Magic numbers for common file types
const MAGIC_NUMBERS = {
  // Images
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  
  // Videos
  'video/mp4': [0x00, 0x00, 0x00], // MP4 files start with various patterns, this is a basic check
  'video/quicktime': [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70], // MOV
  'video/x-msvideo': [0x52, 0x49, 0x46, 0x46], // AVI
  'video/x-matroska': [0x1A, 0x45, 0xDF, 0xA3], // MKV
};

function checkMagicNumber(buffer, expectedMagic) {
  if (buffer.length < expectedMagic.length) {
    return false;
  }
  
  for (let i = 0; i < expectedMagic.length; i++) {
    if (buffer[i] !== expectedMagic[i]) {
      return false;
    }
  }
  
  return true;
}

function validateFileMimeType(filePath, expectedMime) {
  try {
    const buffer = readFileSync(filePath);
    const expectedMagic = MAGIC_NUMBERS[expectedMime];
    
    if (!expectedMagic) {
      // If we don't have magic numbers for this type, skip validation
      return true;
    }
    
    return checkMagicNumber(buffer, expectedMagic);
  } catch (error) {
    return false;
  }
}

function validateFileContent(filePath, mimeType) {
  // Basic validation using magic numbers
  const isValid = validateFileMimeType(filePath, mimeType);
  
  if (!isValid) {
    throw new Error(`File content does not match declared MIME type: ${mimeType}`);
  }
  
  return true;
}

module.exports = {
  validateFileContent,
  validateFileMimeType,
  checkMagicNumber,
};