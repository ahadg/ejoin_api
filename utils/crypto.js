const crypto = require('crypto');

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function calculateAuth(username, password, cnonce, urlResource) {
  const hash = crypto.createHash('md5');
  hash.update(username + password + cnonce + urlResource);
  return hash.digest('hex');
}

function calculateEncryptKey(username, password, auth, session, seq) {
  const hash = crypto.createHash('md5');
  hash.update(username + password + auth + session + seq);
  return hash.digest('hex');
}

module.exports = {
  generateSessionId,
  calculateAuth,
  calculateEncryptKey
};